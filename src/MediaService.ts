import Room from './Room';
import { Peer } from './Peer';
import { MediaNode } from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { KDTree, KDPoint, Logger, skipIfClosed } from 'edumeet-common';
import LoadBalancer from './LoadBalancer';
import { Config } from './Config';

const logger = new Logger('MediaService');

export interface RouterData {
	roomId: string;
	pipePromises: Map<string, Promise<void>>;
}

export interface MediaServiceOptions {
	loadBalancer: LoadBalancer;
	kdTree: KDTree;
}

export type MediaNodeConfig = {
	hostname: string;
	port: number;
	secret: string;
	longitude: number;
	latitude: number;
};

export default class MediaService {
	public closed = false;
	public kdTree: KDTree;
	private loadBalancer: LoadBalancer;

	constructor({ loadBalancer, kdTree } : MediaServiceOptions) {
		logger.debug('constructor() [loadBalancer: %s]', loadBalancer);

		this.loadBalancer = loadBalancer;
		this.kdTree = kdTree;
	}

	public static create(
		loadBalancer: LoadBalancer,
		config: Config
	) {
		logger.debug('create() [loadBalancer: %s, config: %s]', loadBalancer, config);

		if (!config.mediaNodes) throw new Error('No media nodes configured');

		const kdTree = new KDTree([]);

		for (const { hostname, port, secret, longitude, latitude } of config.mediaNodes) {
			const mediaNode = new MediaNode({
				id: randomUUID(),
				hostname,
				port,
				secret,
				kdPoint: new KDPoint([ latitude, longitude ])
			});

			kdTree.addNode(new KDPoint([ latitude, longitude ], { mediaNode }));
		}

		kdTree.rebalance();

		return new MediaService({ loadBalancer, kdTree });
	}

	@skipIfClosed
	public addMediaNode({ hostname, port, secret, longitude, latitude }: MediaNodeConfig) {
		logger.debug('addMediaNode() [hostname: %s, port: %s, secret: %s, longitude: %s, latitude: %s]', hostname, port, secret, longitude, latitude);

		const mediaNode = new MediaNode({ id: randomUUID(), hostname, port, secret, kdPoint: new KDPoint([ latitude, longitude ]) });

		this.kdTree.addNode(new KDPoint([ latitude, longitude ], { mediaNode }));
		this.kdTree.rebalance();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		const mediaNodes = this.kdTree.getAllPoints().map((kdPoint) => kdPoint.appData.mediaNode) as MediaNode[];

		mediaNodes.forEach((mediaNode) => mediaNode.close());
	}

	@skipIfClosed
	public async getRouter(room: Room, peer: Peer): Promise<[ Router, MediaNode ]> {
		logger.debug('getRouter() [roomId: %s, peerId: %s]', room.id, peer.id);

		let candidates: MediaNode[] = [];

		do {
			candidates = this.loadBalancer.getCandidates(this.kdTree, room, peer);

			for (const mediaNode of candidates) {
				try {
					const router = await mediaNode.getRouter({
						roomId: room.sessionId,
						appData: { pipePromises: new Map<string, Promise<void>>() }
					});

					return [ router, mediaNode ];
				} catch (error) {
					logger.error('getRouter() [error %o]', error);
				}
			}
		} while (candidates.length > 0);

		throw new Error('no media nodes available');
	}
}
