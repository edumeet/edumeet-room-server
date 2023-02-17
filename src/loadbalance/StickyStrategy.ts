import { List } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import Room from '../Room';
import { LBStrategy } from './LBStrategy';

export class StickyStrategy extends LBStrategy {
	public getCandidates(mediaNodes: List<MediaNode>, room: Room) {
		const candidates: MediaNode[] = [];
		const candidateIds = room.getActiveMediaNodes();

		mediaNodes.items.forEach((mediaNode) => {
			if (candidateIds.has(mediaNode.id)) {
				candidates.push(mediaNode);
			}
		});
		
		return candidates;
	}
}