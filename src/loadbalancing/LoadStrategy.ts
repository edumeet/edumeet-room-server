import { KDPoint, Logger } from 'edumeet-common';
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

	public filterOnLoad(pointsToFilter: KDPoint[]): KDPoint[] {
		const filteredNodes = this.filterOnLoadThreshold(pointsToFilter);
		
		filteredNodes.forEach((point) => {
			const mediaNode = point.appData.mediaNode as MediaNode;

			logger.debug('filterOnLoad() [node.id %s, node.load %s]', mediaNode.id, mediaNode.load);
		});

		return this.sortOnLoad(filteredNodes);
	}

	private filterOnLoadThreshold(pointsToFilter: KDPoint[]): KDPoint[] {
		return pointsToFilter.filter((point) => {
			const mediaNode = point.appData.mediaNode as MediaNode;
			
			return mediaNode.load < this.threshold;
		});
	}

	private sortOnLoad(pointsToSort: KDPoint[]): KDPoint[] {
		return pointsToSort.sort((a, b) => {
			const mediaNode1 = a.appData.mediaNode as MediaNode;
			const mediaNode2 = b.appData.mediaNode as MediaNode;
			
			return mediaNode1.load - mediaNode2.load;
		});
	}
}