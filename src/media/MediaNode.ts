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
import { DrainingError, MediaNodeConnection } from './MediaNodeConnection';
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
	turnHostname?: string;
	turnports: Array<{
		protocol: string; // turn / turns
		port: number;
		transport: string;
	}>
	kdPoint: KDPoint
}

export declare interface MediaNode {
	// eslint-disable-next-line no-unused-vars
	once(event: 'connectionClosed', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	once(event: 'draining', listener: () => void): this;
}

export class MediaNode extends EventEmitter {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	public turnHostname?: string;
	public turnports: Array<{
		protocol: string; // turn / turns
		port: number;
		transport: string;
	}>;
	public readonly kdPoint: KDPoint;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	private connection?: MediaNodeConnection;
	private healthCheckTimeout?: NodeJS.Timeout;
	public healthy = true;
	public draining = false;
	public load = 0; // Percentage of load 0-100
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
	

	constructor({ id, hostname, port, secret, turnHostname, turnports, kdPoint }: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();
		this.setMaxListeners(Infinity);

		this.id = id;
		this.hostname = hostname;
		this.port = port;
		this.secret = secret;
		this.turnHostname = turnHostname;
		this.turnports = turnports;
		this.kdPoint = kdPoint;

		this.startHealthCheck(true);
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

			this.connection.close();

			this.healthy = false;
			this.startHealthCheck();

			throw error;
		}

		return this.connection;
	}

	private setupConnection(addListeners = true): MediaNodeConnection {
		const secret = this.secret ? `?secret=${this.secret}` : '';
	
		const connection = new MediaNodeConnection({
			url: `wss://${this.hostname}:${this.port}${secret}`,
			timeout: 3000
		});

		if (!addListeners) return connection;

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

		connection.on('draining', () => {
			this.draining = true;

			this.startHealthCheck();

			this.emit('draining');
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

				this.healthy = false;
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

		return connection.request(request).catch((error) => {
			if (error instanceof SocketTimeoutError) {
				logger.error('request() | timeout');

				this.connection?.close();
				this.healthy = false;
				this.startHealthCheck();
			}

			throw error;
		});
	}

	@skipIfClosed
	private startHealthCheck(initial = false): void {
		if (this.healthCheckTimeout) return;

		logger.debug('startHealthCheck()');

		const interval = 10_000;

		const check = async () => {
			await this.healthCheck();

			if (this.healthy && !this.draining) {
				clearTimeout(this.healthCheckTimeout);
				this.healthCheckTimeout = undefined;

				logger.debug('startHealthCheck() | healthy');

				return;
			}

			logger.debug('startHealthCheck() | unhealthy, scheduling next check');
			this.healthCheckTimeout = setTimeout(check, interval);
		};

		this.healthCheckTimeout = setTimeout(check, initial ? 0 : interval);
	}

	@skipIfClosed
	public async healthCheck(): Promise<void> {
		logger.debug('healthCheck()');

		const connection = this.setupConnection(false);
		const [ error ] = await connection.ready;

		connection.close();
	
		if (error) {
			if (error instanceof DrainingError) this.draining = true;

			this.healthy = false;
		} else {
			this.draining = false;
			this.healthy = true;
		}
	}
}
