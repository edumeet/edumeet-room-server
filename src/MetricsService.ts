import { Logger } from 'edumeet-common';
import http from 'http';
import https from 'https';
import crypto from 'crypto';

import fs from 'fs';
import ServerManager from './ServerManager';
import { Stats } from 'fast-stats';

import * as client from 'prom-client';
import { canUsePort } from './common/ports';

class CustomMetrics {
	private register: client.Registry;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private genricStats: { [key: string]: any } = {};
	private statsUpdate = 0;
	private serverManager: ServerManager;
	private mPeers: client.Gauge;
	private mRoomsMediaNode: client.Gauge;
	private period:number = 10;

	constructor(serverManager: ServerManager) {
		this.serverManager = serverManager;
		const register = new client.Registry();

		this.register = register;
		// client.collectDefaultMetrics({ prefix: 'generic_', register });

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this; // Capture the class context

		// generic  metrics
		[
			{ name: 'rooms', statName: 'rooms', help: '- count of all existing rooms', statValue: 'sum' },
			{ name: 'peers', statName: 'peers', help: '- count of all existing peers', statValue: 'sum' }
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

		// user/peer count for a roomId
		this.mPeers = new client.Gauge({ name: 'edumeet_peers', help: 'user/peer count for a roomId', labelNames: [ 'roomId' ], registers: [ this.register ] });
		// roomId and mediaNode pair (if set it is used)
		this.mRoomsMediaNode = new client.Gauge({ name: 'edumeet_rooms_media_node', help: 'roomId and mediaNode pair (if set it is used)', labelNames: [ 'roomId', 'hostname' ], registers: [ this.register ] });

	}

	contentType() {
		return this.register.contentType;
	}
	
	getPeriod() {
		return this.period;
	}
	updatePeriod(period: number) {
		this.period = period;
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
		const period = this.period;

		if (now - this.statsUpdate < period * 1000) {
			return;
		}
		this.statsUpdate = now;

		this.mPeers.reset();
		this.mRoomsMediaNode.reset();

		for (const [ roomId, room ] of this.serverManager.rooms) {
			this.mPeers.labels(roomId).set(room.peers.length);
			
			if (room.mediaNodes && Array.isArray(room.mediaNodes.items)) {
				const items = room.mediaNodes.items;

				for (const item of items) {
					const hostname = item.hostname || item.id;

					this.mRoomsMediaNode.set(
						{ roomId, hostname },
						1
					);
				}
			}
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
	private servers = new Map<string, http.Server>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private liveConfig:any;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	constructor(serverManager: ServerManager, newConfig: any | null) {
		// start metric 
		this.customMetrics = new CustomMetrics(serverManager);

		if (newConfig) {
			this.createServer(newConfig);
		}
	}

	loadPrivateKey(path:string) {
		try {
			const pem = fs.readFileSync(path, 'utf8');

			crypto.createPrivateKey(pem);
			
			return pem;
		} catch {
			throw new Error(`Invalid private key: ${path}`);
		}
	}

	loadCertificate(path:string) {
		try {
			const pem = fs.readFileSync(path, 'utf8');

			const c = new crypto.X509Certificate(pem);
			
			logger.debug('loadCertificate() [cert: %s]', c);

			return pem;
			
		} catch (error) {
			logger.error(error);
			throw new Error(`loadCertificate() failed: ${path}`);
		}
	}

	getOptionsWithValidCerts(key:string, cert:string) {
		let options = {};
		
		try {
			const k = this.loadPrivateKey(key);
			const c = this.loadCertificate(cert);
		
			options = {
				key: k,
				cert: c
			};	
		} catch (error) {
			logger.error(error);
		} finally {
			return options;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async createServer(newConfig: any) {
		const currentlyUsed = this.servers; // servers keys?
		let current:string;

		const started: string[] = [];

		if (newConfig) {
			if (newConfig.prometheus.period != this.customMetrics.getPeriod())
				this.customMetrics.updatePeriod(newConfig.prometheus.period);
			await newConfig.prometheus.listener.forEach((srv: { ip: string; port: number; protocol: string; cert?: { key: string, cert: string } }) => {
				
				const { ip, port, protocol, cert } = srv;
				const mode = (cert)?'https':'http';
				
				// if currently used and part of the config stop server and relaunch 
				current	= `${ip}-${port}-${mode}`;

				if (currentlyUsed.has(current)) {
					const oldServer = this.servers.get(current);

					oldServer?.close();
					currentlyUsed.delete(current);
				} else if (protocol === 'http') {
					this._createHTTPServer(ip, port);
					started.push(current);
				} else if (protocol === 'https' && cert) {
					const options = this.getOptionsWithValidCerts(cert.key, cert.cert);

					if (options) {
						this._createHTTPSServer(ip, port, options);
						started.push(current);
					} else {
						logger.error(`Invalid cert for https(${current})!`);
					}
				} else {
					logger.error(`No cert for https(${current})!`);
				}
			});
			// if not used anymore stop 
			currentlyUsed.forEach(function(value, key) {
				if (!started.includes(key)) {
					const oldServer = currentlyUsed.get(key);

					oldServer?.close();
					currentlyUsed.delete(current);
				}

			});

			this.liveConfig = newConfig;

		}
	}

	private async _createHTTPServer(ip: string, port: number) {
		if (await canUsePort(port, ip)) {
				
			const newServer = http.createServer(async (req, res) => {
				res.writeHead(200, { 'Content-Type': this.customMetrics.contentType() });
				res.end(await this.customMetrics.metrics());
			});

			newServer.listen(port, () => {
				logger.debug(`Server listening to ${port}, metrics exposed on /metrics endpoint`,);

			});

			this.servers.set(`${ip}-${port}-http`, newServer);
		} else {
			logger.debug(`Port (${port}) is in use or invalid!`);
		}

	}
	
	private async _createHTTPSServer(ip: string, port: number, options:object) {
		if (await canUsePort(port, ip)) {
			
			const newServer = https.createServer(options, async (req, res) => {
				res.writeHead(200, { 'Content-Type': this.customMetrics.contentType() });
				res.end(await this.customMetrics.metrics());
			});

			newServer.listen(port, () => {
				logger.debug(`Server listening to ${port}, metrics exposed on /metrics endpoint`,);

			});

			this.servers.set(`${ip}-${port}-http`, newServer);
		} else {
			logger.debug(`Port (${port}) is in use or invalid!`);
		}

	}

	close() {
		this.servers.forEach((server) => {
			server?.close();
		});
	}
}
