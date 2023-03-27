import { Peer } from '../Peer';
import LBStrategy from './LBStrategy';
import { KDPoint, KDTree, Logger } from 'edumeet-common';
import * as geoip from 'geoip-lite';

const logger = new Logger('GeoStrategy');

/**
 * Try to assign peers to media-nodes that are geographically close to client.
 */
export default class GeoStrategy extends LBStrategy {
	private threshold: number;
	private defaultClientPosition: KDPoint;

	constructor(defaultClientPosition: KDPoint, threshold = 2000) {
		super();
		this.defaultClientPosition = defaultClientPosition;
		this.threshold = threshold;
	}

	/**
	 * Remove media-nodes outside of threshold.
	 */
	public filterOnThreshold(points: KDPoint[], peerPosition: KDPoint) {
		logger.debug('filterOnThreshold() [peerPosition: %s]', peerPosition);
		try {
			const filteredCandidates = points.filter((point) => {
				const distance = KDTree.getDistance(peerPosition, point);

				return distance < this.threshold;
			});
			
			return filteredCandidates;
		} catch (err) {
			if (err instanceof Error) logger.error(err.message);
			
			return points;
		}
	}

	/**
	 * Get client position using
	 * 1.) socket.handshake.address
	 * 2.) socket.handshake.headers['x-forwarded-for'] 
	 * 3.) fallback to default client position
	 */
	public getClientPosition(peer: Peer): KDPoint {
		logger.debug('getClientPosition() [peer.id: %s]', peer.id);
		try {
			const address = peer.getAddress().address;
			const clientPos = this.createKDPoint({ address });
			
			return clientPos;
		} catch (err) {
		}
		try {
			const forwardedFor = peer.getAddress().forwardedFor;

			if (forwardedFor) {
				const clientPos = this.createKDPoint({ address: forwardedFor });
				
				return clientPos;
			}
		} catch (err) {
		}
		
		return this.defaultClientPosition;
	}
	
	private createKDPoint({ address }: { address: string }): KDPoint {
		logger.debug('create() [address: %s]', address);
		const geo = geoip.lookup(address);

		if (!geo) {
			throw Error('Geoposition not found');
		} else {
			const [ latitude, longitude ] = geo.ll;
			
			return new KDPoint([ latitude, longitude ]);
		}
	}
}
