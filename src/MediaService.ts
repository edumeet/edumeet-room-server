import Room from './Room';
import { Peer } from './Peer';
import MediaNode from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { KDTree, KDPoint, List, Logger, skipIfClosed } from 'edumeet-common';
import LoadBalancer from './loadbalancing/LoadBalancer';
import { Config } from './Config';

const logger = new Logger('MediaService');

export interface RouterData {
	roomId: string;
	pipePromises: Map<string, Promise<void>>;
}

export interface MediaServiceOptions {
	loadBalancer: LoadBalancer;
	config: Config
	kdTree: KDTree
}

export default class MediaService {
	public closed = false;
	public mediaNodes = List<MediaNode>();
	private loadBalancer: LoadBalancer;
	private kdTree: KDTree;

	constructor({ loadBalancer, kdTree, config } : MediaServiceOptions) {
		logger.debug('constructor()');

		this.loadBalancer = loadBalancer;
		this.kdTree = kdTree;
		this.loadMediaNodes(config);
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaNodes.items.forEach((mediaNode) => mediaNode.close());
		this.mediaNodes.clear();
	}

	@skipIfClosed
	private loadMediaNodes(config: Config): void {
		logger.debug('loadMediaNodes()');

		for (const { hostname, port, secret, longitude, latitude } of config.mediaNodes) {
			const kdPoint = new KDPoint([ latitude, longitude ]);
			const mediaNode = new MediaNode({
				id: randomUUID(), 
				hostname,
				port,
				secret,
				kdPoint
			});

			this.mediaNodes.add();
			this.kdTree.addNode(new KDPoint([ longitude, latitude ], { mediaNode }));
		}
		this.kdTree.rebalance();
	}

	@skipIfClosed
	public async getRouter(room: Room, peer: Peer): Promise<Router> {
		logger.debug('getRouter() [roomId: %s, peerId: %s]', room.id, peer.id);

		const candidates: KDPoint[] = this.loadBalancer.getCandidates(
			{ room, peer, kdTree: this.kdTree });

		let mediaNodeCandidate: MediaNode | undefined;

		// TODO: try all valid candidates, dont assume the first one works
		if (candidates?.length > 0) {
			mediaNodeCandidate = candidates[0].appData.mediaNode as MediaNode;
		} 

		if (!mediaNodeCandidate) {
			throw new Error('no media nodes available');
		} else {
			const router = await mediaNodeCandidate.getRouter({
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
}