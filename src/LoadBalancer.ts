import { KDPoint, KDTree, Logger } from 'edumeet-common';
import MediaNode from './media/MediaNode';
import { Peer } from './Peer';
import Room from './Room';
import * as geoip from 'geoip-lite';

const logger = new Logger('LoadBalancer');

export interface LoadBalancerOptions {
	kdTree: KDTree;
	defaultClientPosition: KDPoint;
	cpuLoadThreshold?: number;
	geoDistanceThreshold?: number;
}

export default class LoadBalancer {
	private readonly cpuLoadThreshold: number;
	private readonly geoDistanceThreshold: number;
	private kdTree: KDTree;
	private readonly defaultClientPosition: KDPoint;

	constructor({
		kdTree,
		defaultClientPosition,
		cpuLoadThreshold = 85,
		geoDistanceThreshold = 2000
	}: LoadBalancerOptions) {
		logger.debug('constructor() [kdTree: %s, defaultClientPosition: %S]', kdTree, defaultClientPosition);
		this.kdTree = kdTree;
		this.defaultClientPosition = defaultClientPosition;
		this.cpuLoadThreshold = cpuLoadThreshold;
		this.geoDistanceThreshold = geoDistanceThreshold;
	}

	public getCandidates(
		room: Room,
		peer: Peer
	): MediaNode[] {
		try {
			logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);
			// Get sticky candidates
			let candidates = room.getActiveMediaNodes()
				.filter((m) => m.load < this.cpuLoadThreshold)
				.sort((a, b) => a.load - b.load);
			const peerGeoPosition = this.getClientPosition(peer) ?? this.defaultClientPosition;

			candidates = this.filterOnGeoThreshold(candidates, peerGeoPosition);
			
			// Get additional candidates from KDTree
			const kdtreeCandidates = this.kdTree.nearestNeighbors(
				peerGeoPosition,
				5,
				(point) => {
					const node = point.appData.mediaNode as unknown as MediaNode;
					
					return node.load < 85;
				}
			);

			// Merge candidates
			kdtreeCandidates?.forEach(([ c ]) => 
				candidates.push(c.appData.mediaNode as MediaNode));
		
			return candidates;

		} catch (err) {
			logger.error(err);	
			
			return [];
		}
	}
	
	/**
	 * Get client position using
	 * 1.) Client direct ipv4 address
	 * 2.) Http header 'x-forwarded-for' from reverse proxy
	 */
	private getClientPosition(peer: Peer): KDPoint | undefined {
		logger.debug('getClientPosition() [peer.id: %s]', peer.id);
		const directAddress = peer.getAddress().address;
		const forwardedForAddress = peer.getAddress().forwardedFor;

		let clientPosition = this.createKDPointFromAddress(directAddress);
		
		if (!clientPosition && forwardedForAddress) {
			clientPosition = this.createKDPointFromAddress(forwardedForAddress);
		}
		
		return clientPosition;
	}
	
	private createKDPointFromAddress(address: string): KDPoint | undefined {
		logger.debug('createKDPointFromAddress() [address: %s]', address);
		const geo = geoip.lookup(address);

		if (geo) {
			const [ latitude, longitude ] = geo.ll;
			
			return new KDPoint([ latitude, longitude ]);
		}
		
		return undefined;
	}
	
	/**
	 * Filter out mediaNodes outside of geo threshold.
	 */
	public filterOnGeoThreshold(mediaNodes: MediaNode[], peerPosition: KDPoint) {
		logger.debug('filterOnGeoThreshold() [peerPosition: %s]', peerPosition);
		
		return mediaNodes.filter(({ kdPoint }) => 
			KDTree.getDistance(peerPosition, kdPoint) < this.geoDistanceThreshold);
	}
}
