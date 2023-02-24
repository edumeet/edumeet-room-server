import config from '../config/config.json';
import Room from './Room';
import { Peer } from './Peer';
import MediaNode from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { List, Logger, skipIfClosed } from 'edumeet-common';
import LoadBalancer, { LbCandidates } from './loadbalancing/LoadBalancer';
import GeoPosition from './loadbalancing/GeoPosition';

const logger = new Logger('MediaService');

let index = 0;

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

		for (const { hostname, port, secret, longitude, latitude } of config.mediaNodes) {
			const geoPosition = new GeoPosition({ longitude, latitude });

			this.mediaNodes.add(new MediaNode({
				id: randomUUID(),
				hostname,
				port,
				secret,
				geoPosition
			}));
		}
	}

	@skipIfClosed
	public async getRouter(room: Room, peer: Peer): Promise<Router> {
		logger.debug('getRouter() [roomId: %s, peerId: %s]', room.id, peer.id);

		const copyOfMediaNodes = [ ...this.mediaNodes.items ];
		const candidateIds: LbCandidates = this.loadBalancer.getCandidates(
			{ copyOfMediaNodes, room, peer });

		let mediaNodeCandidate: MediaNode | undefined;

		// If we have candidates from LoadBalancer try those, else fall back to round-robin
		if (candidateIds) {
			mediaNodeCandidate = this.mediaNodes.get(candidateIds[0]);
		} else {
			mediaNodeCandidate = this.mediaNodes.items[index];
			index += 1;
			index %= this.mediaNodes.length;
		}

		if (!mediaNodeCandidate)
			throw new Error('no media nodes available');

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