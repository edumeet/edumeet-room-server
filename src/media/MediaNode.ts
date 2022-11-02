import { randomUUID } from 'crypto';
import { Logger } from '../common/logger';
import { RouterData } from '../MediaService';
import { Peer } from '../Peer';
import { SocketIOClientConnection } from '../signaling/SocketIOClientConnection';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router, RouterOptions } from './Router';

const logger = new Logger('MediaNode');

interface MediaNodeOptions {
	id: string;
	connectionString: string;
}

export default class MediaNode {
	public id: string;
	public connectionString: string;
	public connection?: MediaNodeConnection;

	private pendingRequests = new Map<string, string>();
	public routers: Map<string, Router> = new Map();

	constructor({
		id,
		connectionString
	}: MediaNodeOptions) {
		logger.debug('constructor() [id: %s]', id);

		this.id = id;
		this.connectionString = connectionString;
	}

	public async getRouter(roomId: string): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', roomId);

		const requestUUID = randomUUID();

		this.pendingRequests.set(requestUUID, roomId);

		if (!this.connection) {
			const socket = SocketIOClientConnection.create({ url: this.connectionString });

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
				connection: this.connection,
				id,
				rtpCapabilities,
				appData: {
					serverData: {
						roomId,
						pipePromises: new Map<string, Promise<void>>(),
						peers: new Map<string, Peer>(),
					} as RouterData
				}
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