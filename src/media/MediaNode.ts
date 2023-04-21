import axios from 'axios';
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
import { IONodeConnection } from '../IONodeConnection';

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
	#secret: string;
	public readonly kdPoint: KDPoint;
	public connection?: MediaNodeConnection;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	private retryTimeoutHandle: undefined | NodeJS.Timeout;
	public health = true;

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
		if (this.retryTimeoutHandle) {
			return;
		}
		this.health = false;
		const backoffIntervals = [
			5000, 5000, 5000,
			30000, 30000, 30000,
			300000, 300000, 300000,
			900000, 900000, 900000
		];
		let retryCount = 0;

		do {
			logger.debug('retryConnection() retryCount [%s]', retryCount);
			const timeoutPromise = new Promise((_, reject) => {
				this.retryTimeoutHandle = setTimeout(
					() => reject(new Error('retryConnection() Timeout')), backoffIntervals[retryCount]);
			});
			const healthPromise = axios.get(`https://${this.hostname}:${this.port}/health`);

			try {
				await Promise.race([ timeoutPromise, healthPromise ]);
				logger.debug('retryConnection() got connection to media-node');
				this.health = true;
			} catch (error) {
				logger.error(error);
			} finally {
				clearTimeout(this.retryTimeoutHandle);
			}
			retryCount++;
		} while (retryCount <= backoffIntervals.length && this.health === false);
		delete this.retryTimeoutHandle;
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
			if (this.retryTimeoutHandle) {
				logger.debug('getRouter() canceling retryConnection()');
				this.health = true;
				clearTimeout(this.retryTimeoutHandle);
				delete this.retryTimeoutHandle;
			}
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
		const socket = IONodeConnection.create({
			url: `wss://${this.hostname}:${this.port}${this.#secret ? `?secret=${this.#secret}` : ''}`,
			timeout: 3000 });

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

		return connection;
	}

	public get load(): number {
		return this.connection?.load ?? 0;
	}
}