import { randomUUID } from 'crypto';
import { KDPoint, Logger, SocketMessage, skipIfClosed } from 'edumeet-common';
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
import { createRecordersMiddleware } from '../middlewares/recordersMiddleware';

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

export declare interface MediaNode {
	// eslint-disable-next-line no-unused-vars
	on(event: 'connectionClosed', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	once(event: 'connectionClosed', listener: () => void): this;
}

export class MediaNode extends EventEmitter {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	public readonly kdPoint: KDPoint;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	private connection?: MediaNodeConnection;
	private healthCheckTimeout?: NodeJS.Timeout;
	public healthy = true;
	public load = 0;
	public secret: string;

	#routersMiddleware = createRoutersMiddleware({ routers: this.routers });
	#webRtcTransportsMiddleware = createWebRtcTransportsMiddleware({ routers: this.routers });
	#pipeTransportsMiddleware = createPipeTransportsMiddleware({ routers: this.routers });
	#producersMiddleware = createProducersMiddleware({ routers: this.routers });
	#pipeProducersMiddleware = createPipeProducersMiddleware({ routers: this.routers });
	#dataProducersMiddleware = createDataProducersMiddleware({ routers: this.routers });
	#pipeDataProducersMiddleware = createPipeDataProducersMiddleware({ routers: this.routers });
	#consumersMiddleware = createConsumersMiddleware({ routers: this.routers });
	#pipeConsumersMiddleware = createPipeConsumersMiddleware({ routers: this.routers });
	#dataConsumersMiddleware = createDataConsumersMiddleware({ routers: this.routers });
	#pipeDataConsumersMiddleware = createPipeDataConsumersMiddleware({ routers: this.routers });
	#activeSpeakerMiddleware = createActiveSpeakerMiddleware({ routers: this.routers });
	#recordersMiddleware = createRecordersMiddleware({ routers: this.routers });

	constructor({ id, hostname, port, secret, kdPoint }: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();
		this.setMaxListeners(Infinity);

		this.id = id;
		this.hostname = hostname;
		this.port = port;
		this.secret = secret;
		this.kdPoint = kdPoint;

		this.startHealthCheck();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.routers.forEach((router) => router.close(true));
		this.routers.clear();

		clearTimeout(this.healthCheckTimeout);
		this.healthCheckTimeout = undefined;

		this.connection?.close();
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const requestUUID = randomUUID();

		try {
			this.pendingRequests.set(requestUUID, roomId);

			const { id, rtpCapabilities } = await this.request({
				method: 'getRouter',
				data: { roomId }
			}) as RouterOptions;

			let router = this.routers.get(id);

			if (!router) {
				router = new Router({ mediaNode: this, id, rtpCapabilities, appData });

				this.routers.set(id, router);

				router.once('close', () => {
					this.routers.delete(id);

					if (this.isUnused) this.connection?.close();

					logger.debug('router "close" event [routerId: %s]', id);
					logger.debug('connection: %o', this.connection);
				});
			}

			return router;
		} catch (error) {
			logger.error('getRouter() [%o]', error);

			throw error;
		} finally {
			this.pendingRequests.delete(requestUUID); 
		}
	}

	get isUnused(): boolean {
		return this.routers.size === 0 && this.pendingRequests.size === 0;
	}

	private async getOrCreateConnection(): Promise<MediaNodeConnection> {
		logger.debug('getOrCreateConnection()');

		if (!this.connection || this.connection.closed) {
			logger.debug('No connection found, creating a new one');

			this.connection = this.setupConnection();
		}

		const [ error ] = await this.connection.ready;

		if (error) {
			logger.error('getOrCreateConnection() [error:%o]', error);

			this.startHealthCheck();

			throw error;
		}

		return this.connection;
	}

	private setupConnection(): MediaNodeConnection {
		const secret = this.secret ? `?secret=${this.secret}` : '';
	
		const connection = new MediaNodeConnection({
			url: `wss://${this.hostname}:${this.port}${secret}`,
			timeout: 3000
		});

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
			this.#activeSpeakerMiddleware,
			this.#recordersMiddleware,
		);

		connection.on('load', (load) => {
			this.load = load;
		});

		connection.once('close', (remoteClose) => {
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
			connection.pipeline.remove(this.#recordersMiddleware);

			if (remoteClose) {
				this.emit('connectionClosed');

				this.startHealthCheck();
			}
		});

		return connection;
	}

	@skipIfClosed
	public async notify(notification: SocketMessage): Promise<void> {
		logger.debug('notify() [method: %s]', notification.method);

		const connection = await this.getOrCreateConnection();

		connection.notify(notification);
	}
	
	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [method: %s]', request.method);

		const connection = await this.getOrCreateConnection();

		return connection.request(request);
	}

	@skipIfClosed
	private startHealthCheck(): void {
		if (this.healthCheckTimeout) return;

		logger.debug('startHealthCheck()');

		const interval = 5000;

		const check = async () => {
			await this.healthCheck();

			if (this.healthy) {
				clearTimeout(this.healthCheckTimeout);
				this.healthCheckTimeout = undefined;

				return;
			}

			this.healthCheckTimeout = setTimeout(check, interval);
		};

		this.healthCheckTimeout = setTimeout(check, interval);
	}

	@skipIfClosed
	public async healthCheck(): Promise<void> {
		logger.debug('healthCheck()');

		const shouldClose = Boolean(!this.connection || this.connection?.closed);

		logger.debug('healthCheck() [shouldClose: %s]', shouldClose);

		let connection;

		try {
			connection = await this.getOrCreateConnection();

			this.healthy = true;
		} catch (error) {
			logger.error('healthCheck() [error:%o]', error);

			this.healthy = false;
		} finally {
			if (shouldClose) connection?.close();
		}
	}
}
