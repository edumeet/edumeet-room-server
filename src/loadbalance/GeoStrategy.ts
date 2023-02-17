import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import { LBStrategy } from './LBStrategy';

export class GeoStrategy extends LBStrategy {
	public getCandidates(mediaNodes: MediaNode[], peer: Peer) {
		const candidates: MediaNode[] = [];

		return candidates;
	}
}