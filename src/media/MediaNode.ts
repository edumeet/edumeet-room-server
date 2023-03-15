import { randomUUID } from 'crypto';
import { IOClientConnection, Logger, skipIfClosed } from 'edumeet-common';
import GeoPosition from '../loadbalancing/GeoPosition';
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
	geoPosition: GeoPosition
}

export default class MediaNode {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	#secret: string;
	public connection?: MediaNodeConnection;
	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();
	public readonly geoPosition: GeoPosition;

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
		geoPosition
	}: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		this.id = id;
		this.hostname = hostname;
		this.port = port;
		this.#secret = secret;
		this.geoPosition = geoPosition;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.routers.forEach((router) => router.close(true));
		this.routers.clear();

		this.connection?.close();
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const requestUUID = randomUUID();

		this.pendingRequests.set(requestUUID, roomId);

		if (!this.connection) {
			this.connection = this.setupConnection();

			this.connection.once('close', () => delete this.connection);
		}

		await this.connection.ready;

		const {
			id,
			rtpCapabilities
		} = await this.connection.request({
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

		this.pendingRequests.delete(requestUUID);

		return router;
	}

	private setupConnection(): MediaNodeConnection {
		const socket = IOClientConnection.create({
			url: `wss://${this.hostname}:${this.port}${this.#secret ? `?secret=${this.#secret}` : ''}`
		});

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
}