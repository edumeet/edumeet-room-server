import axios from 'axios';
import { randomUUID } from 'crypto';
import { IOClientConnection, KDPoint, Logger, skipIfClosed } from 'edumeet-common';
import { createConsumersMiddleware } from '../middlewares/consumersMiddleware';
import { createDataConsumersMiddleware } from '../middlewares/dataConsumersMiddleware';
import { createDataProducersMiddleware } from '../middlewares/dataProducersMiddleware';
import { createPipeConsumersMiddleware } from '../middlewares/pipeConsumersMiddleware';
import { createPipeDataConsumersMiddleware } from '../middlewares/pipeDataConsumersMiddleware';
import { createPipeDataProducersMiddleware } from '../middlewares/pipeDataProducersMiddleware';
import { createPipeProducersMiddleware } from '../middlewares/pipeProducersMiddleware';
import { createPipeTransportsMiddleware } from '../middlewares/pipeTransportsMiddleware';
import { createProducersMiddleware } from '../middlewares/producersMiddleware';
import { createRoutersMiddleware } from '../middlewares/routersMiddleware';
import { createWebRtcTransportsMiddleware } from '../middlewares/webRtcTransportsMiddleware';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router, RouterOptions } from './Router';

const logger = new Logger('MediaNode');

interface GetRouterOptions {
	roomId: string;
	appData?: Record<string, unknown>;
}

interface MediaNodeOptions {
	id: string;
	hostname: string;
	port: number;
	secret: string;
	kdPoint: KDPoint
}

interface MediaNodeHealth {
	status: boolean,
	updatedAt: number | undefined
}

export default class MediaNode {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	#secret: string;
	public readonly kdPoint: KDPoint;
	public connection?: MediaNodeConnection;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	private _health: MediaNodeHealth;
	private restablishingConnection = false;

	private routersMiddleware =
		createRoutersMiddleware({ routers: this.routers });
	private webRtcTransportsMiddleware =
		createWebRtcTransportsMiddleware({ routers: this.routers });
	private pipeTransportsMiddleware =
		createPipeTransportsMiddleware({ routers: this.routers });
	private producersMiddleware =
		createProducersMiddleware({ routers: this.routers });
	private pipeProducersMiddleware =
		createPipeProducersMiddleware({ routers: this.routers });
	private dataProducersMiddleware =
		createDataProducersMiddleware({ routers: this.routers });
	private pipeDataProducersMiddleware =
		createPipeDataProducersMiddleware({ routers: this.routers });
	private consumersMiddleware =
		createConsumersMiddleware({ routers: this.routers });
	private pipeConsumersMiddleware =
		createPipeConsumersMiddleware({ routers: this.routers });
	private dataConsumersMiddleware =
		createDataConsumersMiddleware({ routers: this.routers });
	private pipeDataConsumersMiddleware =
		createPipeDataConsumersMiddleware({ routers: this.routers });

	constructor({
		id,
		hostname,
		port,
		secret,
		kdPoint
	}: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		this.id = id;
		this.hostname = hostname;
		this.port = port;
		this.#secret = secret;
		this.kdPoint = kdPoint;
		this._health = { status: true, updatedAt: undefined };
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.routers.forEach((router) => router.close(true));
		this.routers.clear();

		this.connection?.close();
	}

	public get health() {
		return this._health;
	}

	public markAsUnhealthy() {
		this._health = {
			status: false,
			updatedAt: Date.now() };
		// start logic for going back to healthy (with back off)
		// this.timeOut = 5
		// try catch, increase this.timeOut
		// exponential back-off 5s 5s 5s 30s 30s 30s 5m 5m 5m 15m 15m 15m
		// fetch http request to medianode health endpoint
		if (!this.restablishingConnection) {
			this.restablishingConnection = true;
			this.retryConnection();
		}
	}

	private async retryConnection(retryCount = 0): Promise<void> {
		const backoffIntervals = [
			5000, 5000, 5000,
			30000, 30000, 30000,
			300000, 300000, 300000,
			900000, 900000, 900000
		];

		if (retryCount === backoffIntervals.length) return;
		logger.debug('retryConnection() [retryCount %s]', retryCount);
		try {
			const res = await axios.get(`https://${this.hostname}:${this.port}/health`, { timeout: 3000 });

			if (res?.status === 200) {
				this.restablishingConnection = false;
				this._health = {
					status: true,
					updatedAt: Date.now()
				};
				logger.debug('Got successful polling of media-node');
			} else {
				throw Error('Failed to poll media-node endpoint');
			}
		} catch (error) {
			logger.error(error);
			await this.delay(backoffIntervals[retryCount]);
			
			return this.retryConnection(retryCount + 1);
		}
	}

	private async delay(timeout: number) {
		logger.debug('delay() [retryCount %s]', timeout);

		return new Promise((resolve) => setTimeout(resolve, timeout));
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const requestUUID = randomUUID();

		this.pendingRequests.set(requestUUID, roomId);

		// media-node health handling
		// wrap into timeout logic. 
		// set self as unhealthy
		// throw error, mediaservice will catch and iterate over next candidate
		return await new Promise((resolve, reject) => {
			return setTimeout(async () => {
				try {
					if (!this.connection) {
						this.connection = this.setupConnection();
						this.connection.once('close', () => delete this.connection);
					}
					await this.connection.ready;
					const {
						id,
						rtpCapabilities
					} = await this.connection?.request({
						method: 'getRouter',
						data: { roomId }
					}) as RouterOptions;

					let router = this.routers.get(id);

					if (!router && this.connection) {
						router = new Router({
							mediaNode: this,
							connection: this.connection,
							id,
							rtpCapabilities,
							appData
						});

						this.routers.set(id, router);
						router.once('close', () => {
							this.routers.delete(id);

							if (
								this.routers.size === 0 &&
								this.pendingRequests.size === 0
							) {
								this.connection?.close();
								delete this.connection;
							}
						});
						resolve(router);
					}
					this.pendingRequests.delete(requestUUID);

				} catch (error) {
					logger.error(error);
					this.markAsUnhealthy();
					reject(error);
				}
			}, 750); 
		});
	}

	private setupConnection(): MediaNodeConnection {
		const socket = IOClientConnection.create({
			url: `wss://${this.hostname}:${this.port}${this.#secret ? `?secret=${this.#secret}` : ''}`,
			retries: 2,
			timeout: 250 });

		const connection = new MediaNodeConnection({ connection: socket });

		connection.pipeline.use(
			this.routersMiddleware,
			this.webRtcTransportsMiddleware,
			this.pipeTransportsMiddleware,
			this.producersMiddleware,
			this.pipeProducersMiddleware,
			this.dataProducersMiddleware,
			this.pipeDataProducersMiddleware,
			this.consumersMiddleware,
			this.pipeConsumersMiddleware,
			this.dataConsumersMiddleware,
			this.pipeDataConsumersMiddleware
		);

		connection.once('close', () => {
			connection.pipeline.remove(this.routersMiddleware);
			connection.pipeline.remove(this.webRtcTransportsMiddleware);
			connection.pipeline.remove(this.pipeTransportsMiddleware);
			connection.pipeline.remove(this.producersMiddleware);
			connection.pipeline.remove(this.pipeProducersMiddleware);
			connection.pipeline.remove(this.dataProducersMiddleware);
			connection.pipeline.remove(this.pipeDataProducersMiddleware);
			connection.pipeline.remove(this.consumersMiddleware);
			connection.pipeline.remove(this.pipeConsumersMiddleware);
			connection.pipeline.remove(this.dataConsumersMiddleware);
			connection.pipeline.remove(this.pipeDataConsumersMiddleware);
		});

		connection.addListener('connectionError', () => {
			this.markAsUnhealthy();
		});

		return connection;
	}

	public get load(): number {
		return this.connection?.load ?? 0;
	}
}