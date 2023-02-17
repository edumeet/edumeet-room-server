import config from '../config/config.json';
import Room from './Room';
import { Peer } from './Peer';
import MediaNode from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { List, Logger, skipIfClosed } from 'edumeet-common';
import { LoadBalancer } from './loadbalance/LoadBalancer';

const logger = new Logger('MediaService');

export interface RouterData {
	roomId: string;
	pipePromises: Map<string, Promise<void>>;
}

export default class MediaService {
	public closed = false;
	public mediaNodes = List<MediaNode>();
	private loadBalancer: LoadBalancer;

	constructor(loadBalancer: LoadBalancer) {
		logger.debug('constructor()');

		this.loadMediaNodes();
		this.loadBalancer = loadBalancer;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaNodes.items.forEach((mediaNode) => mediaNode.close());
		this.mediaNodes.clear();
	}

	@skipIfClosed
	private loadMediaNodes(): void {
		logger.debug('loadMediaNodes()');

		for (const { hostname, port, secret } of config.mediaNodes) {
			this.mediaNodes.add(new MediaNode({
				id: randomUUID(),
				hostname,
				port,
				secret,
			}));
		}
	}

	@skipIfClosed
	public async getRouter(room: Room, peer: Peer): Promise<Router> {
		logger.debug('getRouter() [roomId: %s, peerId: %s]', room.id, peer.id);

		let mediaNode: MediaNode = this.mediaNodes.items[0];
		const mediaNodes = this.loadBalancer.getCandidates(this.mediaNodes, room, peer);

		if (mediaNodes.length > 0) {
			mediaNode = mediaNodes[0];
		} 

		if (!mediaNode)
			throw new Error('no media nodes available');

		const router = await mediaNode.getRouter({
			roomId: room.id,
			appData: {
				roomId: room.id,
				pipePromises: new Map<string, Promise<void>>(),
			}
		});

		if (!room.parentClosed)
			room.addRouter(router);
		else {
			router.close();
			throw new Error('room closed');
		}

		return router;
	}
}