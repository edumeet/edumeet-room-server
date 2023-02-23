import { List, Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import Room from '../Room';
import GeoStrategy from './GeoStrategy';
import LBStrategy, { LB_STRATEGIES } from './LBStrategy';
import LBStrategyFactory from './LBStrategyFactory';
import StickyStrategy from './StickyStrategy';

const logger = new Logger('LoadBalancer');

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

	public getCandidates(
		mediaNodes: List<MediaNode>,
		room: Room,
		peer: Peer): MediaNode[] {
		logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);
		let candidates: MediaNode[];

		candidates = this.stickyStrategy.getCandidates(mediaNodes.items, room);

		const geoStrategy = this.strategies.get(LB_STRATEGIES.GEO) as unknown as GeoStrategy;

		if (geoStrategy) {
			candidates = geoStrategy.getCandidates(mediaNodes.items, candidates, peer);
		}
		
		return candidates.length > 0 ? candidates : mediaNodes.items;
	}
}