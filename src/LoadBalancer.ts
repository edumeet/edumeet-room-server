import { KDPoint, KDTree, Logger } from 'edumeet-common';
import MediaNode from './media/MediaNode';
import { Peer } from './Peer';
import Room from './Room';
import * as geoip from 'geoip-lite';
import { ConnectionStatus } from './media/MediaNodeHealth';

const logger = new Logger('LoadBalancer');

export interface LoadBalancerOptions {
	defaultClientPosition: KDPoint;
	cpuLoadThreshold?: number;
	geoDistanceThreshold?: number;
}

export default class LoadBalancer {
	private readonly cpuLoadThreshold: number;
	private readonly geoDistanceThreshold: number;
	private readonly defaultClientPosition: KDPoint;

	constructor({
		defaultClientPosition,
		cpuLoadThreshold = 0.60,
		geoDistanceThreshold = 2000
	}: LoadBalancerOptions) {
		logger.debug('constructor() [kdTree: %s, defaultClientPosition: %S]', defaultClientPosition);
		this.defaultClientPosition = defaultClientPosition;
		this.cpuLoadThreshold = cpuLoadThreshold;
		this.geoDistanceThreshold = geoDistanceThreshold;
	}

	// Split into getRoomCandidates and getGeoCandidates
	public getCandidates(kdTree: KDTree, room: Room, peer: Peer): MediaNode[] {
		try {
			logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);

			const peerGeoPosition = this.getClientPosition(peer) ?? this.defaultClientPosition;
			// Get sticky candidates
			const candidates = room.getActiveMediaNodes()
				.filter((m) =>
					m.connectionStatus === ConnectionStatus.OK &&
					m.load < this.cpuLoadThreshold &&
					KDTree.getDistance(peerGeoPosition, m.kdPoint) < this.geoDistanceThreshold
				)
				.sort((a, b) => a.load - b.load);

			// Get additional candidates from KDTree
			const kdtreeCandidates = kdTree.nearestNeighbors(
				peerGeoPosition,
				5,
				(point) => {
					const m = point.appData.mediaNode as MediaNode;

					if (candidates.includes(m)) return false;

					return m.connectionStatus === ConnectionStatus.OK && m.load < this.cpuLoadThreshold;
				}
			);

			// Merge candidates
			kdtreeCandidates?.forEach(([ c ]) => candidates.push(c.appData.mediaNode as MediaNode));
		
			return candidates;
		} catch (err) {
			logger.error(err);
		}

		return [];
	}
	
	/**
	 * Get client position using
	 * 1.) Client direct ipv4 address
	 * 2.) Http header 'x-forwarded-for' from reverse proxy
	 */
	private getClientPosition(peer: Peer): KDPoint {
		const { address, forwardedFor } = peer.getAddress();

		logger.debug('getClientPosition() [address: %s, forwardedFor: %s]', address, forwardedFor);

		if (forwardedFor) return this.createKDPointFromAddress(forwardedFor) ?? this.defaultClientPosition;
		else return this.createKDPointFromAddress(address) ?? this.defaultClientPosition;
	}
	
	private createKDPointFromAddress(address: string): KDPoint | undefined {
		logger.debug('createKDPointFromAddress() [address: %s]', address);

		const geo = geoip.lookup(address);

		if (geo) return new KDPoint([ ...geo.ll ]);
	}
}
