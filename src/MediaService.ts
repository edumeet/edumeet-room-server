import Room from './Room';
import { Peer } from './Peer';
import { MediaNode } from './media/MediaNode';
import { Router } from './media/Router';
import { randomUUID } from 'crypto';
import { KDTree, KDPoint, Logger, skipIfClosed } from 'edumeet-common';
import { getConfig } from './Config';
import * as geoip from 'geoip-lite';
import { lookup as dnsLookup } from 'dns/promises';

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
	country?: string;
	turnHostname?: string;
	turnports: Array<{
		protocol: string; // turn / turns
		port: number;
		transport: string;
	}>;
};

export default class MediaService {
	public closed = false;
	public kdTree: KDTree;
	public mediaNodes: MediaNode[] = [];

	private readonly loadThreshold: number;
	private readonly geoDistanceThreshold: number;
	private readonly defaultClientPosition: KDPoint;

	private readonly mediaNodeCountries = new Map<string, string>(); // key: hostname

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

		this.bootstrapMediaNodeCountriesFromConfig();
		this.resolveMediaNodeCountries();
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
		country,
		turnHostname,
		turnports
	}: MediaNodeConfig) {
		logger.debug(
			'addMediaNode() [hostname: %s, port: %s, secret: %s, longitude: %s, latitude: %s]',
			hostname,
			port,
			secret,
			longitude,
			latitude
		);

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

		if (country) {
			this.mediaNodeCountries.set(hostname, country.toUpperCase());

			logger.debug(
				{ hostname, country },
				'addMediaNode() media node country from config'
			);
		} else {
			this.resolveMediaNodeCountry(mediaNode);
		}
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
			logger.debug({ roomId: room.id, peerId: peer.id, peer IP: this.getClientIp(peer) }, 'getCandidates()');

			// Get sticky candidates and peer country
			const peerGeoPosition = this.getClientPosition(peer) ?? this.defaultClientPosition;

			const peerCountry = this.getClientCountry(peer);

			// Find the best (nearest) geo candidate distance under normal constraints.
			// Used to decide whether it is worth breaking stickiness when sticky is too far.
			const bestGeoCandidate = kdTree.nearestNeighbors(peerGeoPosition, 1, (point) => {
				const m = point.appData.mediaNode as MediaNode;

				return !m.draining && m.healthy && m.load < this.loadThreshold;
			});

			const bestGeoDistance = bestGeoCandidate?.[0]?.[1] ?? Number.POSITIVE_INFINITY;

			const geoGainRatio = 0.75; // >25% closer => split (new node)

			const stickyEvaluation = room.mediaNodes.items.map((m) => {
				const { distance, reasons, eligible } = this.getSelectionReasons(
					m,
					peerGeoPosition,
					bestGeoDistance,
					{
						enforceGeoDistance: true,
						enforceLoad: true,
					}
				);

				return {
					id: m.id,
					hostname: m.hostname,
					port: m.port,
					healthy: m.healthy,
					draining: m.draining,
					load: m.load,
					distance,
					eligible,
					reasons,
					nodeCountry: this.getNodeCountry(m),
				};
			});

			logger.debug(
				{
					peerGeoPosition,
					peerCountry,
					defaultClientPosition: this.defaultClientPosition,
					loadThreshold: this.loadThreshold,
					geoDistanceThreshold: this.geoDistanceThreshold,
					bestGeoDistance,
					geoGainRatio,
					sticky: stickyEvaluation
				},
				'getCandidates() sticky evaluation'
			);

			const candidates = room.mediaNodes.items
				.filter(({ draining, healthy, load, kdPoint }) => {
					if (draining) return false;
					if (!healthy) return false;
					if (load >= this.loadThreshold) return false;

					const distance = KDTree.getDistance(peerGeoPosition, kdPoint);

					// Normal sticky behavior when within threshold
					if (distance < this.geoDistanceThreshold) return true;

					// If sticky is far, keep it unless the best geo node is >25% closer
					return !(bestGeoDistance < distance * geoGainRatio);
				})
				.sort((a, b) => a.load - b.load);

			// Get additional candidates from KDTree (any country)
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

			// Same-country preference for initial node assignment:
			// - only when room has no sticky nodes yet
			// - and we know peerCountry
			// We query same-country nodes separately to avoid 5 or more nodes in the same location, hiding other nodes.
			const sameCountryDelta = 0.15;
			const sameCountryResult = this.applySameCountryPreference({
				room,
				peerCountry,
				peerGeoPosition,
				kdTree,
				candidates,
				geoCandidates,
				sameCountryDelta,
			});

			const geoFallback = sameCountryResult.geoFallback;

			let geoPreferred = sameCountryResult.geoPreferred;

			// If no same-country preference applied, fall back to original geo order.
			if (!geoPreferred.length && geoCandidates) {
				geoPreferred = geoCandidates.map(([ p ]) => p.appData.mediaNode as MediaNode);
			}

			logger.debug(
				{
					geoCandidates: (geoCandidates ?? []).map(([ p, distance ]) => {
						const m = p.appData.mediaNode as MediaNode;
						const { reasons, eligible } = this.getSelectionReasons(
							m,
							peerGeoPosition,
							bestGeoDistance,
							{
								enforceGeoDistance: false,
								enforceLoad: true,
								duplicate: candidates.includes(m),
							}
						);

						return {
							id: m.id,
							hostname: m.hostname,
							port: m.port,
							healthy: m.healthy,
							draining: m.draining,
							load: m.load,
							distance,
							eligible,
							reasons,
							nodeCountry: this.getNodeCountry(m),
						};
					}),
					lastResortCandidates: (lastResortCandidates ?? []).map(([ p, distance ]) => {
						const m = p.appData.mediaNode as MediaNode;
						const { reasons, eligible } = this.getSelectionReasons(
							m,
							peerGeoPosition,
							bestGeoDistance,
							{
								enforceGeoDistance: false,
								enforceLoad: false,
								duplicate: candidates.includes(m),
							}
						);

						return {
							id: m.id,
							hostname: m.hostname,
							port: m.port,
							healthy: m.healthy,
							draining: m.draining,
							load: m.load,
							distance,
							eligible,
							reasons,
							nodeCountry: this.getNodeCountry(m),
						};
					}),
				},
				'getCandidates() kd-tree evaluation'
			);

			// Merge candidates: sticky -> geoPreferred -> geoFallback -> lastResort
			geoPreferred.forEach((m) => {
				if (!candidates.includes(m)) candidates.push(m);
			});

			geoFallback.forEach((m) => {
				if (!candidates.includes(m)) candidates.push(m);
			});

			lastResortCandidates?.forEach(([ c ]) => {
				const m = c.appData.mediaNode as MediaNode;

				if (!candidates.includes(m)) candidates.push(m);
			});

			logger.debug(
				{
					finalCandidates: candidates.map((m) => {
						const { distance, reasons, eligible } = this.getSelectionReasons(
							m,
							peerGeoPosition,
							bestGeoDistance,
							{
								enforceGeoDistance: false,
								enforceLoad: false,
								duplicate: false,
							}
						);

						return {
							id: m.id,
							hostname: m.hostname,
							port: m.port,
							healthy: m.healthy,
							draining: m.draining,
							load: m.load,
							distance,
							eligible,
							reasons,
							nodeCountry: this.getNodeCountry(m),
						};
					}),
				},
				'getCandidates() final candidates'
			);

			return candidates;
		} catch (err) {
			logger.error(err);
		}

		return [];
	}

	/**
	 * Extract the best-guess client IP from the Peer.
	 * Priority:
	 * 1. First IP in the `x-forwarded-for` header (can be a list)
	 * 2. Direct peer address
	 */
	private getClientIp(peer: Peer): string | undefined {
		const { address, forwardedFor } = peer.getAddress();

		logger.debug(
			{ address, forwardedFor },
			'getClientIp() received peer addresses'
		);

		let ip: string | undefined;

		if (forwardedFor) {
			const ff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

			ip = ff.split(',')[0]?.trim();
		}

		if (!ip) {
			ip = address;
		}

		logger.debug({ ip }, 'getClientIp() resolved client IP');

		return ip || undefined;
	}

	/**
	 * Get client position using
	 * 1.) Client direct ipv4 address
	 * 2.) Http header 'x-forwarded-for' from reverse proxy
	 */
	private getClientPosition(peer: Peer): KDPoint {
		const ip = this.getClientIp(peer);

		logger.debug({ ip }, 'getClientPosition() using IP');

		return (ip && this.createKDPointFromAddress(ip)) ?? this.defaultClientPosition;
	}

	/**
	 * Get client country using
	 * 1.) Client direct ipv4 address
	 * 2.) Http header 'x-forwarded-for' from reverse proxy
	 */
	private getClientCountry(peer: Peer): string | undefined {
		const ip = this.getClientIp(peer);

		logger.debug({ ip }, 'getClientCountry() using IP');

		if (!ip) {
			logger.debug('getClientCountry() no IP resolved, returning undefined');

			return;
		}

		const geo = geoip.lookup(ip);

		logger.debug({ ip, geo }, 'getClientCountry() geo lookup result');

		return geo?.country;
	}

	private createKDPointFromAddress(address: string): KDPoint | undefined {
		logger.debug('createKDPointFromAddress() [address: %s]', address);

		const geo = geoip.lookup(address);

		if (geo) return new KDPoint([ ...geo.ll ]);
	}

	private bootstrapMediaNodeCountriesFromConfig(): void {
		if (!config.mediaNodes) return;

		for (const { hostname, country } of config.mediaNodes) {
			if (!country) continue;

			this.mediaNodeCountries.set(hostname, country.toUpperCase());

			logger.debug(
				{ hostname, country },
				'bootstrapMediaNodeCountriesFromConfig() media node country from config'
			);
		}
	}

	private resolveMediaNodeCountries(): void {
		for (const mediaNode of this.mediaNodes) {
			if (!this.getNodeCountry(mediaNode)) this.resolveMediaNodeCountry(mediaNode);
		}
	}

	private resolveMediaNodeCountry(mediaNode: MediaNode): void {
		(async () => {
			try {
				const { address } = await dnsLookup(mediaNode.hostname, { family: 4 });

				const geo = geoip.lookup(address);

				if (!geo?.country) {
					logger.debug(
						{ hostname: mediaNode.hostname, address },
						'resolveMediaNodeCountry() geoip lookup missing country'
					);

					return;
				}

				this.mediaNodeCountries.set(mediaNode.hostname, geo.country.toUpperCase());

				logger.debug(
					{ hostname: mediaNode.hostname, address, country: geo.country },
					'resolveMediaNodeCountry() resolved'
				);
			} catch (error) {
				logger.debug(
					{ err: error, hostname: mediaNode.hostname },
					'resolveMediaNodeCountry() failed'
				);
			}
		})();
	}

	private getNodeCountry(mediaNode: MediaNode): string | undefined {
		return this.mediaNodeCountries.get(mediaNode.hostname);
	}

	private getSelectionReasons(
		m: MediaNode,
		peerGeoPosition: KDPoint,
		bestGeoDistance: number,
		{
			enforceGeoDistance = false,
			enforceLoad = false,
			duplicate = false,
		}: { enforceGeoDistance?: boolean; enforceLoad?: boolean; duplicate?: boolean } = {}
	): { distance: number; reasons: string[]; eligible: boolean } {
		const reasons: string[] = [];

		const distance = KDTree.getDistance(peerGeoPosition, m.kdPoint);

		if (duplicate) reasons.push('DUPLICATE');
		if (m.draining) reasons.push('DRAINING');
		if (!m.healthy) reasons.push('UNHEALTHY');
		if (enforceLoad && m.load >= this.loadThreshold) reasons.push('OVERLOAD');

		// Sticky distance logic:
		// - If within geoDistanceThreshold => OK
		// - If farther, only mark TOO_FAR when the best geo node is >25% closer.
		if (enforceGeoDistance && distance >= this.geoDistanceThreshold) {
			if (bestGeoDistance < distance * 0.75) reasons.push('TOO_FAR');
		}

		return { distance, reasons, eligible: reasons.length === 0 };
	}

	private applySameCountryPreference(params: {
		room: Room;
		peerCountry?: string;
		peerGeoPosition: KDPoint;
		kdTree: KDTree;
		candidates: MediaNode[];
		geoCandidates?: [KDPoint, number][];
		sameCountryDelta: number;
	}): { geoPreferred: MediaNode[]; geoFallback: MediaNode[] } {
		const {
			room,
			peerCountry,
			peerGeoPosition,
			kdTree,
			candidates,
			geoCandidates,
			sameCountryDelta,
		} = params;

		const geoPreferred: MediaNode[] = [];

		const geoFallback: MediaNode[] = [];

		// Only apply for initial node selection (no sticky nodes yet) and when we know peerCountry.
		if (room.mediaNodes.length === 0 && peerCountry && geoCandidates && geoCandidates.length > 0) {
			const sameCountryNN = kdTree.nearestNeighbors(peerGeoPosition, 5, (point) => {
				const m = point.appData.mediaNode as MediaNode;

				if (candidates.includes(m)) return false;

				const nodeCountry = this.getNodeCountry(m);

				if (!nodeCountry || nodeCountry !== peerCountry) return false;

				return !m.draining && m.healthy && m.load < this.loadThreshold;
			});

			const sameCountryMapped = (sameCountryNN ?? []).map(([ p, distance ]) => {
				const m = p.appData.mediaNode as MediaNode;

				return {
					mediaNode: m,
					distance,
					nodeCountry: this.getNodeCountry(m),
				};
			});

			const geoMapped = (geoCandidates ?? []).map(([ p, distance ]) => {
				const m = p.appData.mediaNode as MediaNode;

				return {
					mediaNode: m,
					distance,
					nodeCountry: this.getNodeCountry(m),
				};
			});

			const otherMapped = geoMapped.filter((c) => c.nodeCountry && c.nodeCountry !== peerCountry);

			if (sameCountryMapped.length > 0 && otherMapped.length > 0) {
				const bestOtherDistance = Math.min(...otherMapped.map((c) => c.distance));

				const maxSameCountryDistance = bestOtherDistance * (1 + sameCountryDelta);

				const preferredSameCountry = sameCountryMapped.filter((c) => {
					if (!Number.isFinite(bestOtherDistance)) return true;

					return c.distance <= maxSameCountryDistance;
				});

				if (preferredSameCountry.length > 0) {
					const preferred = preferredSameCountry.map((c) => c.mediaNode);

					const preferredSet = new Set(preferred);

					const fallback = geoMapped
						.filter((c) => !preferredSet.has(c.mediaNode))
						.map((c) => c.mediaNode);

					logger.debug(
						{
							peerCountry,
							sameCountryDelta,
							bestOtherDistance,
							maxSameCountryDistance,
							preferredSameCountry: preferredSameCountry.map((c) => ({
								id: c.mediaNode.id,
								hostname: c.mediaNode.hostname,
								distance: c.distance,
								nodeCountry: c.nodeCountry,
							})),
							otherCandidates: otherMapped.map((c) => ({
								id: c.mediaNode.id,
								hostname: c.mediaNode.hostname,
								distance: c.distance,
								nodeCountry: c.nodeCountry,
							})),
						},
						'getCandidates() same-country preference applied'
					);

					return { geoPreferred: preferred, geoFallback: fallback };
				}
			} else if (sameCountryMapped.length > 0 && otherMapped.length === 0) {
				// Only same-country nodes known in the top list (or no other-country nodes).
				const preferred = sameCountryMapped.map((c) => c.mediaNode);

				const preferredSet = new Set(preferred);

				const fallback = geoMapped
					.filter((c) => !preferredSet.has(c.mediaNode))
					.map((c) => c.mediaNode);

				logger.debug(
					{
						peerCountry,
						sameCountryDelta,
						preferredSameCountry: sameCountryMapped.map((c) => ({
							id: c.mediaNode.id,
							hostname: c.mediaNode.hostname,
							distance: c.distance,
							nodeCountry: c.nodeCountry,
						})),
						otherCandidates: otherMapped.map((c) => ({
							id: c.mediaNode.id,
							hostname: c.mediaNode.hostname,
							distance: c.distance,
							nodeCountry: c.nodeCountry,
						})),
					},
					'getCandidates() same-country preference (no other-country candidates)'
				);

				return { geoPreferred: preferred, geoFallback: fallback };
			}
		}

		return { geoPreferred, geoFallback };
	}
}
