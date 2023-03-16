import { Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import Room from '../Room';
import GeoStrategy from './GeoStrategy';
import LBStrategy, { LB_STRATEGIES } from './LBStrategy';
import LBStrategyFactory from './LBStrategyFactory';
import LoadStrategy from './LoadStrategy';
import StickyStrategy from './StickyStrategy';

const logger = new Logger('LoadBalancer');

export interface LoadBalancerOptions {
	room: Room,
	peer: Peer,
	copyOfMediaNodes: MediaNode[]
}

/**
 * Sort media-nodes using load balancing strategies.
 */
export default class LoadBalancer {
	private strategies: Map<string, LBStrategy>;
	private stickyStrategy: StickyStrategy;
	private loadStrategy: LoadStrategy;

	constructor(factory: LBStrategyFactory) {
		logger.debug('constructor() [factory: %s]', factory);
		this.stickyStrategy = factory.createStickyStrategy();
		this.loadStrategy = factory.createLoadStrategy();
		this.strategies = factory.createStrategies();
	}

	public getCandidates({
		copyOfMediaNodes,
		room,
		peer
	}: LoadBalancerOptions): LbCandidates {
		try {
			logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);

			const loadCandidates = this.loadStrategy.getCandidates(copyOfMediaNodes);
			const stickyCandidates = this.stickyStrategy.getCandidates(loadCandidates, room);

			if (stickyCandidates.length > 0) {
				const filteredCandidates = this.filterOnGeoPosition(stickyCandidates, peer);

				if (filteredCandidates.length > 0) {
					return this.createCandidates(filteredCandidates);
				}
			} 				
			const sortedCandidates = this.sortOnGeoPosition(loadCandidates, peer);
			
			return this.createCandidates(sortedCandidates);

		} catch (err) {
			if (err instanceof Error) logger.error('Error while getting candidates');
			
			return [];
		}
	}

	private createCandidates(mediaNodes: MediaNode[]): LbCandidates {
		const ids: string[] = [];	

		mediaNodes.forEach((node) => {
			ids.push(node.id);
		});
		
		return ids;
	}

	private filterOnGeoPosition(mediaNodes: MediaNode[], peer: Peer): MediaNode[] {
		const geoStrategy = this.strategies.get(
			LB_STRATEGIES.GEO
		) as unknown as GeoStrategy;

		if (this.strategies.has(LB_STRATEGIES.GEO)) {
			return geoStrategy.filterOnThreshold(mediaNodes, peer);
		} else {
			return mediaNodes;
		}

	}
	
	private sortOnGeoPosition(mediaNodes: MediaNode[], peer: Peer): MediaNode[] {
		const geoStrategy = this.strategies.get(
			LB_STRATEGIES.GEO
		) as unknown as GeoStrategy;

		if (this.strategies.has(LB_STRATEGIES.GEO)) {
			return geoStrategy.sortOnDistance(mediaNodes, peer);
		}
		
		return mediaNodes;
	}
}

export type LbCandidates = string[]