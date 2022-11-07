import { skipIfClosed } from '../common/decorators';
import { Logger } from '../common/logger';
import { createMediaNodeMiddleware } from '../middlewares/mediaNodeMiddleware';
import { SocketIOClientConnection } from '../signaling/SocketIOClientConnection';
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
}

export default class MediaNode {
	public id: string;
	public closed = false;
	public hostname: string;
	public port: number;
	#secret: string;
	public roomConnections: Map<string, MediaNodeConnection> = new Map();
	public routers: Map<string, Router> = new Map();

	constructor({
		id,
		hostname,
		port,
		secret
	}: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		this.id = id;
		this.hostname = hostname;
		this.port = port;
		this.#secret = secret;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.routers.forEach((router) => router.closeConnection());
		this.routers.clear();
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		let connection = this.roomConnections.get(roomId);

		if (!connection) {
			const socket = SocketIOClientConnection.create({
				url: `wss://${this.hostname}:${this.port}?roomId=${roomId}${this.#secret ? `&secret=${this.#secret}` : ''}`,
			});

			connection = new MediaNodeConnection({ connection: socket });
			this.roomConnections.set(roomId, connection);
			connection.once('close', () => this.roomConnections.delete(roomId));
			connection.pipeline.use(createMediaNodeMiddleware({ mediaNode: this }));
		}

		await connection.ready;

		const {
			id,
			rtpCapabilities
		} = await connection.request({
			method: 'getRouter',
			data: {}
		}) as RouterOptions;

		let router = this.routers.get(id);

		if (!router) {
			router = new Router({
				mediaNode: this,
				connection,
				id,
				rtpCapabilities,
				appData
			});

			this.addRouter(router);
		}

		return router;
	}

	public addRouter(router: Router) {
		logger.debug('addRouter() [routerId: %s]', router.id);

		this.routers.set(router.id, router);
		router.once('close', () => this.routers.delete(router.id));
	}
}