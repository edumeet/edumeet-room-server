import config from '../config/config.json';
import { Logger } from './common/logger';
import Room from './Room';
import { skipIfClosed } from './common/decorators';
import { List } from './common/list';
import { Peer } from './Peer';
import MediaNode from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';

const logger = new Logger('MediaService');

let index = 0;

export interface RouterData {
	roomId: string;
	pipePromises: Map<string, Promise<void>>;
	peers: Map<string, Peer>;
}

export default class MediaService {
	public closed = false;
	public mediaNodes = List<MediaNode>();

	constructor() {
		logger.debug('constructor()');

		this.loadMediaNodes();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaNodes.items.forEach((mediaNode) => mediaNode.close());
	}

	@skipIfClosed
	private loadMediaNodes(): void {
		logger.debug('loadMediaNodes()');

		for (const { hostname, port } of config.mediaNodes) {
			this.mediaNodes.add(new MediaNode({
				id: randomUUID(),
				connectionString: `wss://${hostname}:${port}`,
			}));
		}
	}

	@skipIfClosed
	public async getRouter(room: Room): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', room.id);

		const mediaNode = this.mediaNodes.items[index];

		index += 1;
		index %= this.mediaNodes.length;

		if (!mediaNode)
			throw new Error('no media nodes available');

		const router = await mediaNode.getRouter(room.id);

		if (!room.parentClosed)
			room.addRouter(router);
		else {
			router.close();
			throw new Error('room closed');
		}

		return router;
	}
}