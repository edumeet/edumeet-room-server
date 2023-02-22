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
			const clientPos = this.getClientPosition(peer);

			const filteredCandidates = mediaNodes.filter((candidate) => {
				const distance = clientPos.getDistance(candidate.geoPosition);

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
			const clientPos = this.getClientPosition(peer);

			const sortedCandidates = mediaNodes.sort((a, b) => {
				const aPos = a.geoPosition;
				const bPos = b.geoPosition;
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

	/**
	 * Get client position using
	 * 1.)  
	 */
	private getClientPosition(peer: Peer) {
		try {
			const address = peer.getAddress().address;
			const clientPos = new GeoPosition({ address });
			
			return clientPos;
		} catch (err) {
		}
		try {
			const forwardedFor = peer.getAddress().forwardedFor;
			const clientPos = new GeoPosition({ address: forwardedFor });

			return clientPos;
		} catch (err) {
		}

		throw Error('Could not create client geoPosition');
	}
}