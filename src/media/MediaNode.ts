import { randomUUID } from 'crypto';
import { IOClientConnection, Logger, skipIfClosed } from 'edumeet-common';
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
	public connection?: MediaNodeConnection;
	private pendingRequests = new Map<string, string>();
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

		this.routers.forEach((router) => router.close(true));
		this.connection?.close();
		this.routers.clear();
	}

	public async getRouter({ roomId, appData }: GetRouterOptions): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const requestUUID = randomUUID();

		this.pendingRequests.set(requestUUID, roomId);

		if (!this.connection) {
			const socket = IOClientConnection.create({
				url: `wss://${this.hostname}:${this.port}${this.#secret ? `?secret=${this.#secret}` : ''}`
			});

			this.connection = new MediaNodeConnection({ connection: socket });
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
}