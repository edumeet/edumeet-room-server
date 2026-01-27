import { Logger } from 'edumeet-common';
import http from 'http';

import ServerManager from './ServerManager';
import { Stats } from 'fast-stats';

import * as client from 'prom-client';

class CustomMetrics {
	private register: client.Registry;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private genricStats: { [key: string]: any } = {};
	private statsUpdate = 0;
	private serverManager: ServerManager;
	private mPeers: client.Gauge;

	constructor(serverManager: ServerManager) {
		this.serverManager = serverManager;
		const register = new client.Registry();

		this.register = register;
		// client.collectDefaultMetrics({ prefix: 'generic_', register });

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this; // Capture the class context

		// generic  metrics
		[
			{ name: 'rooms', statName: 'rooms', help: '- count of all existing rooms', statValue: 'sum' }
		].forEach(({ name, statName, help, statValue }) => {
			// eslint-disable-next-line no-new
			new client.Gauge({
				name: `generic_${name}`,
				help: `Generic ${help || name}`,
				labelNames: [],
				registers: [ register ],
				async collect() {
					await self.collectStats();

					if (self.genricStats[statName] !== undefined && self.genricStats[statName][statValue] !== undefined) {
						this.set({}, self.genricStats[statName][statValue]);
					} else {
						// logger.warn(`${statName}.${statValue} not found`);
					}
				}
			});
		});
		
		this.mPeers = new client.Gauge({ name: 'edumeet_peers', help: '#peers', labelNames: [ 'room_id' ], registers: [ this.register ] });

	}

	contentType() {
		return this.register.contentType;
	}

	async metrics() {
		// log start 
		// last run check HERE 
		// this.collectStats()
		const metrics = await this.register.metrics();
		// log end 

		return metrics;
	}
	// ####### Specific stuff 

	formatStats(s: Stats) {
		return {
			length: s.length || 0,
			sum: s.sum || 0,
			mean: s.amean() || 0,
			stddev: s.stddev() || 0,
			p25: s.percentile(25) || 0,
			min: s.min || 0,
			max: s.max || 0
		};
	}

	collectStats() {
		const now = Date.now();
		// TODO add to config prom_period 
		// Prometheus metrics exporter update period 
		const period = 15;

		if (now - this.statsUpdate < period * 1000) {
			return;
		}
		this.statsUpdate = now;
		
		this.mPeers.reset();
		for (const [ roomId, room ] of this.serverManager.rooms) {
			this.mPeers.labels(roomId).set(room.peers.length);
		}

		Object.assign(this.genricStats, {
			'rooms': this.formatStats(new Stats().push(this.serverManager.rooms.size)),
			'peers': this.formatStats(new Stats().push(this.serverManager.peers.size))
		});
	}

}

const logger = new Logger('MetricsService');

export default class CustomMetricsService {
	private customMetrics: CustomMetrics;
	// private servers = new Map<string, http.Server>();
	private serverManager: ServerManager | undefined;
	private server: http.Server | undefined;

	constructor(serverManager: ServerManager/* ,  managementService */) {
		// start metric 
		this.customMetrics = new CustomMetrics(serverManager);
		// start timer/interval
		// start server?

	}

	startServer() {
		this.server = http.createServer(async (req, res) => {
			res.writeHead(200, { 'Content-Type': this.customMetrics.contentType() });
			res.end(await this.customMetrics.metrics());
		});

		const port = 3000;

		this.server.listen(port, () => {
			logger.debug(`Server listening to ${port}, metrics exposed on /metrics endpoint`,);
		});
	}
	close() {
		this.server?.close();
	}
}
