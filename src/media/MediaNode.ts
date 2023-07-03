import { randomUUID } from 'crypto';
import { KDPoint, Logger, skipIfClosed } from 'edumeet-common';
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
import https from 'https';

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

export default class MediaNode {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	public readonly kdPoint: KDPoint;
	public connection?: MediaNodeConnection;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	#health = true;
	#secret: string;
	#load = 0;
	#retryTimeoutHandle: undefined | NodeJS.Timeout;

	#routersMiddleware =
		createRoutersMiddleware({ routers: this.routers });
	#webRtcTransportsMiddleware =
		createWebRtcTransportsMiddleware({ routers: this.routers });
	#pipeTransportsMiddleware =
		createPipeTransportsMiddleware({ routers: this.routers });
	#producersMiddleware =
		createProducersMiddleware({ routers: this.routers });
	#pipeProducersMiddleware =
		createPipeProducersMiddleware({ routers: this.routers });
	#dataProducersMiddleware =
		createDataProducersMiddleware({ routers: this.routers });
	#pipeDataProducersMiddleware =
		createPipeDataProducersMiddleware({ routers: this.routers });
	#consumersMiddleware =
		createConsumersMiddleware({ routers: this.routers });
	#pipeConsumersMiddleware =
		createPipeConsumersMiddleware({ routers: this.routers });
	#dataConsumersMiddleware =
		createDataConsumersMiddleware({ routers: this.routers });
	#pipeDataConsumersMiddleware =
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
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.routers.forEach((router) => router.close(true));
		this.routers.clear();

		this.connection?.close();
	}

	private async retryConnection(): Promise<void> {
		logger.debug('retryConnection()');
		if (this.#retryTimeoutHandle) {
			return;
		}
		this.#health = false;
		const backoffIntervals = [
			5000, 5000, 5000,
			30000, 30000, 30000,
			300000, 300000, 300000,
			900000, 900000, 900000
		];
		let retryCount = 0;

		do {
			const timeoutPromise = new Promise((_, reject) => {
				this.#retryTimeoutHandle = setTimeout(
					() => reject(new Error('retryConnection() Timeout')), backoffIntervals[retryCount]);
			});
			const healthPromise = new Promise<void>((resolve, reject) => {
				https.get(`https://${this.hostname}:${this.port}/health`, (resp) => {
					if (resp.statusCode === 200) resolve();
					else reject();
				}).on('error', () => reject());
			});

			try {
				await Promise.race([ timeoutPromise, healthPromise ]);
				this.#health = true;
			} catch (error) {
				logger.error(error);
			} finally {
				clearTimeout(this.#retryTimeoutHandle);
			}
			retryCount++;
		} while (retryCount <= backoffIntervals.length && this.#health === false);
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);
		const requestUUID = randomUUID();

		this.pendingRequests.set(requestUUID, roomId);

		if (!this.connection) {
			this.connection = this.setupConnection();
			this.connection.once('close', () => delete this.connection);
		}

		try {
			await this.connection.ready;
		} catch (error) {
			this.connection.close();
			this.pendingRequests.delete(requestUUID);
			this.retryConnection();

			throw error;
		}

		try {
			const {
				id,
				rtpCapabilities
			} = await this.connection?.request({
				method: 'getRouter',
				data: { roomId }
			}) as RouterOptions;

			let router = this.routers.get(id);

			if (!router) {
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
			} 
			
			return router;

		} catch (error) {
			logger.error(error);
			this.retryConnection();
			throw error;
		} finally {
			this.pendingRequests.delete(requestUUID); 
		}
	}

	private setupConnection(): MediaNodeConnection {
		const secret = this.#secret ? `?secret=${this.#secret}` : '';
		const connection = new MediaNodeConnection({
			url: `wss://${this.hostname}:${this.port}${secret}`,
			timeout: 3000 });

		connection.pipeline.use(
			this.#routersMiddleware,
			this.#webRtcTransportsMiddleware,
			this.#pipeTransportsMiddleware,
			this.#producersMiddleware,
			this.#pipeProducersMiddleware,
			this.#dataProducersMiddleware,
			this.#pipeDataProducersMiddleware,
			this.#consumersMiddleware,
			this.#pipeConsumersMiddleware,
			this.#dataConsumersMiddleware,
			this.#pipeDataConsumersMiddleware
		);

		connection.on('load', (load) => {
			if (typeof load === 'number') this.#load = load;
			else logger.error('Got erroneous load from media-node');
		});

		connection.once('close', () => {
			connection.pipeline.remove(this.#routersMiddleware);
			connection.pipeline.remove(this.#webRtcTransportsMiddleware);
			connection.pipeline.remove(this.#pipeTransportsMiddleware);
			connection.pipeline.remove(this.#producersMiddleware);
			connection.pipeline.remove(this.#pipeProducersMiddleware);
			connection.pipeline.remove(this.#dataProducersMiddleware);
			connection.pipeline.remove(this.#pipeDataProducersMiddleware);
			connection.pipeline.remove(this.#consumersMiddleware);
			connection.pipeline.remove(this.#pipeConsumersMiddleware);
			connection.pipeline.remove(this.#dataConsumersMiddleware);
			connection.pipeline.remove(this.#pipeDataConsumersMiddleware);
		});

		return connection;
	}

	public get load(): number {
		return this.#load;
	}

	public get health(): boolean {
		return this.#health;
	}
}