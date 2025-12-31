import Room from './Room';
import { Peer } from './Peer';
import { MediaNode } from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { KDTree, KDPoint, Logger, skipIfClosed } from 'edumeet-common';
import { getConfig } from './Config';
import * as geoip from 'geoip-lite';

const logger = new Logger('MediaService');
const config = getConfig();

export interface RouterData {
	roomId: string;
	pipePromises: Map<string, Promise<void>>;
}

export interface MediaServiceOptions {
	kdTree: KDTree;
	mediaNodes: MediaNode[];
	defaultClientPosition: KDPoint;
	loadThreshold?: number;
	geoDistanceThreshold?: number;
}

export type MediaNodeConfig = {
	hostname: string;
	port: number;
	secret: string;
	longitude: number;
	latitude: number;
	turnHostname?: string;
	turnports: Array<{
		protocol: string; // turn / turns
		port: number;
		transport: string;
	}>
};

export default class MediaService {
	public closed = false;
	public kdTree: KDTree;
	public mediaNodes: MediaNode[] = [];

	private readonly loadThreshold: number;
	private readonly geoDistanceThreshold: number;
	private readonly defaultClientPosition: KDPoint;

	constructor({
		kdTree,
		mediaNodes,
		defaultClientPosition,
		loadThreshold = 60,
		geoDistanceThreshold = 1500,
	}: MediaServiceOptions) {
		logger.debug('constructor()');

		this.kdTree = kdTree;
		this.mediaNodes = mediaNodes;
		this.defaultClientPosition = defaultClientPosition;
		this.loadThreshold = loadThreshold;
		this.geoDistanceThreshold = geoDistanceThreshold;
	}

	public static create() {
		logger.debug('create()');

		if (!config.mediaNodes) throw new Error('No media nodes configured');

		const kdTree = new KDTree([]);
		const mediaNodes: MediaNode[] = [];

		for (const { hostname, port, secret, longitude, latitude, turnHostname, turnports } of config.mediaNodes) {
			const mediaNode = new MediaNode({
				id: randomUUID(),
				hostname,
				port,
				secret,
				turnHostname,
				turnports,
				kdPoint: new KDPoint([ latitude, longitude ])
			});

			kdTree.addNode(new KDPoint([ latitude, longitude ], { mediaNode }));
			mediaNodes.push(mediaNode);
		}

		kdTree.rebalance();

		const defaultClientPosition = new KDPoint([ 50.0, 9.0 ]); // "Middle of Europe"

		return new MediaService({ kdTree, mediaNodes, defaultClientPosition });
	}

	@skipIfClosed
	public addMediaNode({
		hostname,
		port,
		secret,
		longitude,
		latitude,
		turnHostname,
		turnports
	}: MediaNodeConfig) {
		logger.debug('addMediaNode() [hostname: %s, port: %s, secret: %s, longitude: %s, latitude: %s]', hostname, port, secret, longitude, latitude);

		const mediaNode = new MediaNode({
			id: randomUUID(),
			hostname,
			port,
			secret,
			turnHostname,
			turnports,
			kdPoint: new KDPoint([ latitude, longitude ]),
		});

		this.kdTree.addNode(new KDPoint([ latitude, longitude ], { mediaNode }));
		this.kdTree.rebalance();

		this.mediaNodes.push(mediaNode);
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		const mediaNodes = this.kdTree.getAllPoints().map((kdPoint) => kdPoint.appData.mediaNode) as MediaNode[];

		mediaNodes.forEach((mediaNode) => mediaNode.close());
	}

	@skipIfClosed
	public async getRouter(room: Room, peer: Peer): Promise<[Router, MediaNode]> {
		logger.debug('getRouter() [roomId: %s, peerId: %s]', room.id, peer.id);

		let candidates: MediaNode[] = [];

		do {
			candidates = this.getCandidates(this.kdTree, room, peer);

			for (const mediaNode of candidates) {
				try {
					const router = await mediaNode.getRouter({
						roomId: room.sessionId,
						appData: { pipePromises: new Map<string, Promise<void>>() }
					});

					return [ router, mediaNode ];
				} catch (error) {
					logger.error({ err: error }, 'getRouter() [error %o]');
				}
			}
		} while (candidates.length > 0);

		throw new Error('no media nodes available');
	}

	public getCandidates(kdTree: KDTree, room: Room, peer: Peer): MediaNode[] {
		try {
			logger.debug('getCandidates() [room.id: %s, peer.id: %s]', room.id, peer.id);

			// Get sticky candidates
			const peerGeoPosition = this.getClientPosition(peer) ?? this.defaultClientPosition;
			const candidates = room.mediaNodes.items
				.filter(({ draining, healthy, load, kdPoint }) =>
					!draining &&
					healthy &&
					load < this.loadThreshold &&
					KDTree.getDistance(peerGeoPosition, kdPoint) < this.geoDistanceThreshold
				)
				.sort((a, b) => a.load - b.load);

			// Get additional candidates from KDTree
			const geoCandidates = kdTree.nearestNeighbors(peerGeoPosition, 5, (point) => {
				const m = point.appData.mediaNode as MediaNode;
				
				if (candidates.includes(m)) return false;

				return !m.draining && m.healthy && m.load < this.loadThreshold;
			});

			const lastResortCandidates = kdTree.nearestNeighbors(peerGeoPosition, 5, (point) => {
				const m = point.appData.mediaNode as MediaNode;
				
				if (candidates.includes(m)) return false;

				return !m.draining && m.healthy;
			});

			// Merge candidates
			geoCandidates?.forEach(([ c ]) => candidates.push(c.appData.mediaNode as MediaNode));
			lastResortCandidates?.forEach(([ c ]) => candidates.push(c.appData.mediaNode as MediaNode));

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

		if (forwardedFor) {
			const ff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
			const ip = ff.split(',')[0].trim();

			return this.createKDPointFromAddress(ip) ?? this.defaultClientPosition;
		}
		else return this.createKDPointFromAddress(address) ?? this.defaultClientPosition;
	}

	private createKDPointFromAddress(address: string): KDPoint | undefined {
		logger.debug('createKDPointFromAddress() [address: %s]', address);

		const geo = geoip.lookup(address);

		if (geo) return new KDPoint([ ...geo.ll ]);
	}

}
