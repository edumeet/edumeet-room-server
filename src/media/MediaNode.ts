import { randomUUID } from 'crypto';
import { KDPoint, Logger, SocketMessage, SocketTimeoutError, skipIfClosed } from 'edumeet-common';
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
import { createActiveSpeakerMiddleware } from '../middlewares/activeSpeakerMiddleware';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router, RouterOptions } from './Router';
import EventEmitter from 'events';
import MediaNodeHealth, { ConnectionStatus } from './MediaNodeHealth';

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

export default class MediaNode extends EventEmitter {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	public readonly kdPoint: KDPoint;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	#connection?: MediaNodeConnection;
	#health: MediaNodeHealth;
	#secret: string;

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
	#activeSpeakerMiddleware = 
		createActiveSpeakerMiddleware({ routers: this.routers });

	constructor({
		id,
		hostname,
		port,
		secret,
		kdPoint
	}: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();

		this.id = id;
		this.hostname = hostname;
		this.port = port;
		this.#secret = secret;
		this.kdPoint = kdPoint;
		this.#health = new MediaNodeHealth({ hostname, port });
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.routers.forEach((router) => router.close(true));
		this.routers.clear();

		this.#connection?.close();
		this.#health.close();
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);
		const requestUUID = randomUUID();

		this.pendingRequests.set(requestUUID, roomId);

		if (!this.#connection) {
			this.#connection = this.#setupConnection();
		}

		try {
			await this.#connection.ready;
		} catch (error) {
			this.#connection.close();
			this.pendingRequests.delete(requestUUID);
			logger.error('getRouter() [%o]', error);
			this.#health.retryConnection();

			throw error;
		}

		try {
			const {
				id,
				rtpCapabilities
			} = await this.#connection?.request({
				method: 'getRouter',
				data: { roomId }
			}) as RouterOptions;

			let router = this.routers.get(id);

			if (!router) {
				router = new Router({
					mediaNode: this,
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
						this.#connection?.close();
						this.#connection = undefined;
					}
				});
			} 
			
			return router;

		} catch (error) {
			logger.error('getRouter() [%o]', error);
			this.#health.retryConnection();
			throw error;
		} finally {
			this.pendingRequests.delete(requestUUID); 
		}
	}

	#setupConnection(): MediaNodeConnection {
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
			this.#pipeDataConsumersMiddleware,
			this.#activeSpeakerMiddleware
		);

		connection.on('load', (load) => {
			if (load && typeof load === 'number') this.#health.load = load;
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
			connection.pipeline.remove(this.#activeSpeakerMiddleware);
			this.#connection = undefined;
		});

		return connection;
	}

	@skipIfClosed
	public async notify(notification: SocketMessage): Promise<void> {
		logger.debug('notify() [method: %s]', notification.method);
		await this.#connection?.ready;
		this.#connection?.emit('notification', notification);
	}
	
	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [method: %s]', request.method);
		try {
			await this.#connection?.ready;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const response: any = await this.#connection?.request(request);
			
			return response;
			
		} catch (error) {
			if (error instanceof SocketTimeoutError) {
				logger.error('request() [method: %s, %o]', request.method, error);
				this.#health.retryConnection();
			}
			throw error;
		}
	}

	public get load(): number {
		return this.#health.load;
	}

	public get connectionStatus(): ConnectionStatus {
		return this.#health.getConnectionStatus();
	}
}