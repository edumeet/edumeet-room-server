import { KDPoint, KDTree, Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import Room from '../Room';
import GeoStrategy from './GeoStrategy';
import LBStrategyFactory from './LBStrategyFactory';
import LoadStrategy from './LoadStrategy';
import StickyStrategy from './StickyStrategy';

const logger = new Logger('LoadBalancer');

export interface LoadBalancerOptions {
	room: Room,
	peer: Peer,
	kdTree: KDTree
}

/**
 * Sort media-nodes using load balancing strategies.
 */
export default class LoadBalancer {
	private stickyStrategy: StickyStrategy;
	private loadStrategy: LoadStrategy;
	private geoStrategy: GeoStrategy;

	constructor(factory: LBStrategyFactory, defaultClientPosition: KDPoint) {
		logger.debug('constructor() [factory: %s]', factory);
		this.stickyStrategy = factory.createStickyStrategy();
		this.loadStrategy = factory.createLoadStrategy();
		this.geoStrategy = factory.createGeoStrategy(defaultClientPosition);
	}

	public getCandidates({
		room,
		peer,
		kdTree
	}: LoadBalancerOptions): KDPoint[] {
		try {
			logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);

			const stickyCandidates = this.stickyStrategy.getCandidates(room);
			const loadCandidates = this.loadStrategy.filterOnLoad(stickyCandidates);

			const clientPosition = this.geoStrategy.getClientPosition(peer);
			const geoCandidates = this.geoStrategy.filterOnThreshold(
				loadCandidates,
				clientPosition
			);
			const kdtreeCandidates = kdTree.nearestNeighbors(
				clientPosition,
				5,
				(point) => {
					const node = point.appData.mediaNode as unknown as MediaNode;
					
					return node.load < 0.85;
				}
			);

			if (kdtreeCandidates) {
				kdtreeCandidates.forEach((candidate) => {
					geoCandidates.push(candidate[0]);	
				});
			}
		
			return geoCandidates;

		} catch (err) {
			if (err instanceof Error) logger.error('Error while getting candidates');
			
			return [];
		}
	}
}
