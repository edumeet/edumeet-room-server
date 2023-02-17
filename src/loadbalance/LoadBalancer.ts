import { List } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import Room from '../Room';
import { LoadBalanceStrategy } from './LoadBalanceStrategy';
import { StickyStrategy } from './StickyStrategy';

export class LoadBalancer {
	private stickyStrategy: LoadBalanceStrategy;
	private strategies = new Map<string, LoadBalanceStrategy>();

	constructor(stickyStrategy: StickyStrategy) {
		this.stickyStrategy = stickyStrategy;
	}

	public addStrategy(name: string, strategy: LoadBalanceStrategy) {
		this.strategies.set(name, strategy);
	}

	public getCandidates(mediaNodes: List<MediaNode>, room: Room) {
		const stickyCandidates = this.stickyStrategy.getCandidates(mediaNodes, room);
		
		return stickyCandidates;
	}
    
}