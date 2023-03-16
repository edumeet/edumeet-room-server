import { Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import Room from '../Room';
import LBStrategy from './LBStrategy';

const logger = new Logger('StickyStrategy');

/**
 * Try to assign peers to a media-node where room is active.
 */
export default class StickyStrategy extends LBStrategy {
	public getCandidates(allMediaNodes: MediaNode[], room: Room) {
		logger.debug('getCandidates() [room.id: %s]', room.id);
		const candidates: MediaNode[] = [];
		const candidateIds = room.getActiveMediaNodes();

		allMediaNodes.forEach((mediaNode) => {
			if (candidateIds.has(mediaNode.id)) {
				candidates.push(mediaNode);
			}
		});
		
		return candidates;
	}
}