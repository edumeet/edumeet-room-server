import { KDPoint, Logger } from 'edumeet-common';
import Room from '../Room';
import LBStrategy from './LBStrategy';

const logger = new Logger('StickyStrategy');

/**
 * Try to assign peers to a media-node where room is active.
 */
export default class StickyStrategy extends LBStrategy {
	public getCandidates(room: Room) {
		logger.debug('getCandidates() [room.id: %s]', room.id);
		const candidates: KDPoint[] = room.getActiveMediaNodes();
		
		return candidates;
	}
}