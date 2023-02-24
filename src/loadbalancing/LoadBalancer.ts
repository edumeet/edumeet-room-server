import { Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import Room from '../Room';
import GeoStrategy from './GeoStrategy';
import LBStrategy, { LB_STRATEGIES } from './LBStrategy';
import LBStrategyFactory from './LBStrategyFactory';
import StickyStrategy from './StickyStrategy';

const logger = new Logger('LoadBalancer');

export interface LoadBalancerOptions {
	room: Room,
	peer: Peer,
	copyOfMediaNodes: MediaNode[]
}

/**
 * Sort media-nodes according to load balancing strategies.
 */
export default class LoadBalancer {
	private strategies: Map<string, LBStrategy>;
	private stickyStrategy: StickyStrategy;

	constructor(factory: LBStrategyFactory) {
		logger.debug('constructor() [factory: %s]', factory);
		this.stickyStrategy = factory.createStickyStrategy();
		this.strategies = factory.createStrategies();
	}

	public getCandidates({
		copyOfMediaNodes,
		room,
		peer
	}: LoadBalancerOptions): LbCandidates {
		logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);
		let mediaNodes: MediaNode[];

		mediaNodes = this.stickyStrategy.getCandidates(copyOfMediaNodes, room);

		const geoStrategy = this.strategies.get(LB_STRATEGIES.GEO) as unknown as GeoStrategy;

		if (geoStrategy) {
			mediaNodes = geoStrategy.getCandidates(copyOfMediaNodes, mediaNodes, peer);
		}
		
		if (mediaNodes.length > 0) {
			return this.createCandidates(mediaNodes);
		} else {
			return this.createCandidates(copyOfMediaNodes);
		}
	}

	private createCandidates(mediaNodes: MediaNode[]): LbCandidates {
		const ids: string[] = [];	

		mediaNodes.forEach((node) => {
			ids.push(node.id);
		});
		
		return ids;
	}
}

export type LbCandidates = string[]