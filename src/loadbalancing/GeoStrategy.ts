import MediaNode from '../media/MediaNode';
import { Peer } from '../Peer';
import LBStrategy from './LBStrategy';
import { Logger } from 'edumeet-common';
import GeoPosition from './GeoPosition';

const logger = new Logger('GeoStrategy');

/**
 * Try to assign peers to media-nodes that are geographically close to client.
 */
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
		logger.debug('getCandidates() [peer.id %s]', peer.id);

		if (stickyCandidates.length > 0) {
			const filteredCandidates = this.filterOnThreshold(stickyCandidates, peer);

			if (filteredCandidates.length > 0) {
				if (filteredCandidates.length > 1) {
					return this.sortOnDistance(filteredCandidates, peer);
				}
				
				return filteredCandidates;
			}
		}
		
		return this.sortOnDistance(mediaNodes, peer);
	}

	/**
	 * Remove media-nodes outside of threshold.
	 */
	private filterOnThreshold(mediaNodes: MediaNode[], peer: Peer) {
		logger.debug('filterOnThreshold() [peer.id: %s]', peer.id);
		try {
			const clientPos = this.getClientPosition(peer);

			const filteredCandidates = mediaNodes.filter((candidate) => {
				const distance = clientPos.getDistance(candidate.geoPosition);

				if (distance > this.threshold) return false;
				
				return true;
			});
			
			return filteredCandidates;
		} catch (err) {
			if (err instanceof Error) logger.error(err.message);
			
			return mediaNodes;
		}
	}

	/**
	 * Sort media-nodes on geographical position.
	 */
	private sortOnDistance(mediaNodes: MediaNode[], peer: Peer) {
		logger.debug('sortOnDistance() [peer.id: %s]', peer.id);
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
			if (err instanceof Error) logger.error(err.message);
			
			return mediaNodes;
		}
	}

	/**
	 * Get client position using
	 * 1.) socket.handshake.address
	 * 2.) socket.handshake.headers['x-forwardeded-for'] 
	 */
	private getClientPosition(peer: Peer) {
		logger.debug('getClientPosition() [peer.id: %s]', peer.id);
		try {
			const address = peer.getAddress().address;
			const clientPos = GeoPosition.create({ address });
			
			return clientPos;
		} catch (err) {
		}
		try {
			const forwardedFor = peer.getAddress().forwardedFor;

			if (forwardedFor) {
				const clientPos = GeoPosition.create({ address: forwardedFor });
				
				return clientPos;
			}
		} catch (err) {
		}

		throw Error('Could not create client geoPosition');
	}
}