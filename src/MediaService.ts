import Room, { RoomClosedError } from './Room';
import { Peer } from './Peer';
import MediaNode from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { KDTree, KDPoint, List, Logger, skipIfClosed } from 'edumeet-common';
import LoadBalancer from './LoadBalancer';
import { Config } from './Config';

const logger = new Logger('MediaService');

export interface RouterData {
	roomId: string;
	pipePromises: Map<string, Promise<void>>;
}

export interface MediaServiceOptions {
	loadBalancer: LoadBalancer;
}

export default class MediaService {
	public closed = false;
	public mediaNodes = List<MediaNode>();
	private loadBalancer: LoadBalancer;

	constructor({ loadBalancer } : MediaServiceOptions) {
		logger.debug('constructor() [loadBalancer: %s]', loadBalancer);

		this.loadBalancer = loadBalancer;
	}

	public static create(
		loadBalancer: LoadBalancer,
		kdTree: KDTree,
		config: Config
	) {
		logger.debug('create() [loadBalancer: %s, kdtree: %s, config: %s]', loadBalancer, kdTree, config);
		const mediaService = new MediaService({ loadBalancer });

		for (const { hostname, port, secret, longitude, latitude } of config.mediaNodes) {
			const mediaNode = new MediaNode({
				id: randomUUID(), 
				hostname,
				port,
				secret,
				kdPoint: new KDPoint([ longitude, latitude ])
			});

			mediaService.mediaNodes.add(mediaNode);
			kdTree.addNode(new KDPoint([ longitude, latitude ], { mediaNode }));
		}
		kdTree.rebalance();
		
		return mediaService; 
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaNodes.items.forEach((mediaNode) => mediaNode.close());
		this.mediaNodes.clear();
	}

	@skipIfClosed
	public async getRouter(room: Room, peer: Peer): Promise<Router> {
		logger.debug('getRouter() [roomId: %s, peerId: %s]', room.id, peer.id);

		let candidates: MediaNode[] = [];

		do { 
			candidates = this.loadBalancer.getCandidates(room, peer);

			for (const c of candidates) {
				try {
					const router = await c.getRouter({
						roomId: room.id,
						appData: {
							roomId: room.id,
							pipePromises: new Map<string, Promise<void>>(),
						}
					});

					return router;
				} catch (error) {
					logger.error('getRouter() [error %o]', error);
					if (error instanceof RoomClosedError) throw error;
				}
			}		
		} while (candidates.length > 0);
		
		// TODO: notify client
		throw new Error('no media nodes available');
	}
}