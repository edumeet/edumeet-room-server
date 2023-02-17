import { List } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import Room from '../Room';
import { LBStrategy } from './LBStrategy';
import { LBStrategyFactory } from './LBStrategyFactory';
import { StickyStrategy } from './StickyStrategy';

export class LoadBalancer {
	private strategies: Map<string, LBStrategy>;
	private stickyStrategy: StickyStrategy;

	constructor(factory: LBStrategyFactory) {
		this.stickyStrategy = factory.createStickyStrategy();
		this.strategies = factory.createStrategies();
	}

	public getCandidates(mediaNodes: List<MediaNode>, room: Room, peer?: Peer) {
		const stickyCandidates = this.stickyStrategy.getCandidates(mediaNodes, room);
		
		return stickyCandidates;
	}

	private hasGeoStrategy(): boolean {
		return this.strategies.has('geo');
	}
}