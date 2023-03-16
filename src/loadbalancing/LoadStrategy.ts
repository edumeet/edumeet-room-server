import { Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import LBStrategy from './LBStrategy';

const logger = new Logger('LoadStrategy');

/**
 * Try to assign peers to media-nodes based on cpu load.
 */
export default class LoadStrategy extends LBStrategy {
	private threshold: number;

	constructor(threshold = 0.85) {
		super();
		this.threshold = threshold;
	}

	public getCandidates(nodesToSort: MediaNode[]): MediaNode[] {
		const filteredNodes = this.filterOnLoadThreshold(nodesToSort);
		
		filteredNodes.forEach((node) =>
			logger.debug('getCandidates() [node.id %s, node.load %s]', node.id, node.load));
		
		return filteredNodes.sort((a, b) => a.load - b.load);
	}

	private filterOnLoadThreshold(nodesToFilter: MediaNode[]): MediaNode[] {
		return nodesToFilter.filter((node) => node.load < this.threshold);
	}
}