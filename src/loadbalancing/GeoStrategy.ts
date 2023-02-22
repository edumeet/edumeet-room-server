import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import LBStrategy from './LBStrategy';
import { Logger } from 'edumeet-common';
import GeoPosition from './GeoPosition';

const logger = new Logger('GeoStrategy');

export default class GeoStrategy extends LBStrategy {
	private threshold: number;

	constructor(threshold = 2000) {
		super();
		this.threshold = threshold;
	}

	public getCandidates(
		mediaNodes: MediaNode[],
		stickyCandidates: MediaNode[], 
		peer: Peer) {
		logger.debug('getting candidates for peer id', peer.id);

		if (stickyCandidates.length > 0) {
			logger.debug('filtering candidates where room is active');
			
			const filteredCandidates = this.filterOnThreshold(stickyCandidates, peer);

			if (filteredCandidates.length > 0) {
				if (filteredCandidates.length > 1) {
					return this.sortOnDistance(filteredCandidates, peer);
				}
				
				return filteredCandidates;
			}
			logger.debug('active medianodes for room not within threshold', this.threshold, 'km');			
		}

		return this.sortOnDistance(mediaNodes, peer);
	}

	private filterOnThreshold(mediaNodes: MediaNode[], peer: Peer) {
		try {
			const clientPos = new GeoPosition(peer.getAddress());

			const filteredCandidates = mediaNodes.filter((candidate) => {
				// Shomehow we need to make sure this is an ipv4 address
				const mediaNodePos = new GeoPosition(candidate.hostname);
				const distance = clientPos.getDistance(mediaNodePos);

				logger.debug('distance to ', candidate.id, 'is', distance, 'km');
				if (distance > this.threshold) {
					logger.debug(candidate.id, 'not within threshold:', this.threshold, 'km');
					
					return false;
				} else {
					logger.debug('adding', candidate.id, 'as candidate');
					
					return true;
				}
			});
			
			return filteredCandidates;
		} catch (err) {
			logger.error(err);
			
			return mediaNodes;
		}
	}

	private sortOnDistance(mediaNodes: MediaNode[], peer: Peer) {
		try {
			const clientPos = new GeoPosition(peer.getAddress());

			const sortedCandidates = mediaNodes.sort((a, b) => {
				const aPos = new GeoPosition(a.hostname);
				const bPos = new GeoPosition(b.hostname);
				const aDistance = clientPos.getDistance(aPos);
				const bDistance = clientPos.getDistance(bPos);

				return aDistance - bDistance;	
			});
		
			return sortedCandidates;
		} catch (err) {
			logger.error(err);
			
			return mediaNodes;
		}
	}

}