import { Logger } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import Room from '../Room';
import LBStrategy from './LBStrategy';

const logger = new Logger('StickyStrategy');

export default class StickyStrategy extends LBStrategy {
	public getCandidates(mediaNodes: MediaNode[], room: Room) {
		logger.debug('getting sticky candidates for room', room.id);
		const candidates: MediaNode[] = [];
		const candidateIds = room.getActiveMediaNodes();

		mediaNodes.forEach((mediaNode) => {
			if (candidateIds.has(mediaNode.id)) {
				candidates.push(mediaNode);
			}
		});
		
		return candidates;
	}
}