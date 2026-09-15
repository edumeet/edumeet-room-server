import { KDPoint, KDTree, List } from 'edumeet-common';
import * as geoip from 'geoip-lite';
import 'jest';
import MediaService from '../../src/MediaService';
import { MediaNode } from '../../src/media/MediaNode';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';

jest.mock('geoip-lite', () => ({ lookup: jest.fn() }));
jest.mock('../../src/Config', () => ({
	getConfig: () => ({
		countryToRegion: { DE: [ 'EEA', 'DACH' ], PL: 'EEA', CZ: 'EEA', FI: 'EEA', NG: 'AFRICA' }
	})
}));

interface NodeSpec { name: string; country?: string; position: number[]; load?: number; healthy?: boolean; draining?: boolean }

const fakeNode = ({ name, position, load = 0, healthy = true, draining = false }: NodeSpec): MediaNode =>
	({ id: name, hostname: `${name}.invalid`, port: 3443, healthy, draining, load, kdPoint: new KDPoint(position) }) as unknown as MediaNode;

const createService = (specs: NodeSpec[]): { mediaService: MediaService; nodes: Record<string, MediaNode> } => {
	const kdTree = new KDTree([]);
	const nodes: Record<string, MediaNode> = {};
	const mediaService = new MediaService({ kdTree, mediaNodes: [], defaultClientPosition: new KDPoint([ 50, 10 ]) });
	const countries = (mediaService as unknown as { mediaNodeCountries: Map<string, string> }).mediaNodeCountries;

	for (const spec of specs) {
		const mediaNode = fakeNode(spec);

		nodes[spec.name] = mediaNode;
		kdTree.addNode(new KDPoint(spec.position, { mediaNode }));
		if (spec.country) countries.set(mediaNode.hostname, spec.country);
	}

	kdTree.rebalance();

	return { mediaService, nodes };
};

const room = (allowedMediaNodeRegions?: string[]): Room =>
	({ id: 'room', sessionId: 'room', closed: false, mediaNodes: List<MediaNode>(), allowedMediaNodeRegions }) as unknown as Room;

const peerAt = (position: number[], country?: string): Peer => {
	(geoip.lookup as jest.Mock).mockReturnValue({ ll: position, country });

	return { id: 'peer', displayName: 'peer', closed: false, getAddress: () => ({ address: '1.2.3.4' }) } as unknown as Peer;
};

// Called through an untyped alias so the same tests also compile against the previous signature without `exclude`.
const names = (mediaService: MediaService, r: Room, p: Peer, exclude?: Set<MediaNode>): string[] =>
	// eslint-disable-next-line no-unused-vars
	(mediaService.getCandidates as unknown as (...args: unknown[]) => MediaNode[])
		.call(mediaService, mediaService.kdTree, r, p, ...(exclude ? [ exclude ] : []))
		.map((m) => m.id);

// Distances from Warsaw: poznan ~280 km, berlin ~520 km, prague ~520 km, helsinki ~915 km, lagos ~5300 km.
const warsaw = [ 52.23, 21.01 ];
const europe: NodeSpec[] = [
	{ name: 'poznan', country: 'PL', position: [ 52.41, 16.93 ] },
	{ name: 'berlin', country: 'DE', position: [ 52.52, 13.40 ] },
	{ name: 'prague', country: 'CZ', position: [ 50.08, 14.44 ] },
	{ name: 'helsinki', country: 'FI', position: [ 60.17, 24.94 ] },
	{ name: 'lagos', country: 'NG', position: [ 6.52, 3.38 ] },
];

test('orders nodes by distance when the peer country is unknown', () => {
	const { mediaService } = createService(europe);

	expect(names(mediaService, room(), peerAt(warsaw))).toEqual([ 'poznan', 'prague', 'berlin', 'helsinki', 'lagos' ]);
});

test('puts a same-country node first when it is at most 15% farther than the nearest foreign node', () => {
	// From [52, 15]: the DE node is ~68 km away, the PL node ~75 km (within 15%).
	const { mediaService } = createService([
		{ name: 'de-near', country: 'DE', position: [ 52.0, 14.0 ] },
		{ name: 'pl-near', country: 'PL', position: [ 52.0, 16.1 ] },
		{ name: 'helsinki', country: 'FI', position: [ 60.17, 24.94 ] },
	]);

	expect(names(mediaService, room(), peerAt([ 52.0, 15.0 ], 'PL'))).toEqual([ 'pl-near', 'de-near', 'helsinki' ]);
	expect(names(mediaService, room(), peerAt([ 52.0, 15.0 ], 'DE'))).toEqual([ 'de-near', 'pl-near', 'helsinki' ]);
});

test('keeps the nearest foreign node first when the same-country node is more than 15% farther', () => {
	// From [52, 15]: the DE node is ~68 km away, the PL node ~89 km (beyond 15%).
	const { mediaService } = createService([
		{ name: 'de-near', country: 'DE', position: [ 52.0, 14.0 ] },
		{ name: 'pl-far', country: 'PL', position: [ 52.0, 16.3 ] },
	]);

	expect(names(mediaService, room(), peerAt([ 52.0, 15.0 ], 'PL'))).toEqual([ 'de-near', 'pl-far' ]);
});

test('applies the same-country preference only while the room has no media node yet', () => {
	const { mediaService, nodes } = createService([
		{ name: 'de-near', country: 'DE', position: [ 52.0, 14.0 ] },
		{ name: 'pl-near', country: 'PL', position: [ 52.0, 16.1 ] },
	]);
	const stickyRoom = room();

	stickyRoom.mediaNodes.add(nodes['de-near']);

	expect(names(mediaService, stickyRoom, peerAt([ 52.0, 15.0 ], 'PL'))).toEqual([ 'de-near', 'pl-near' ]);
});

test('excludes nodes outside the tenant regions from every list', () => {
	const { mediaService } = createService([ ...europe, { name: 'unmapped', position: [ 52.3, 21.0 ] } ]);

	expect(names(mediaService, room([ 'EEA' ]), peerAt(warsaw, 'PL'))).toEqual([ 'poznan', 'prague', 'berlin', 'helsinki' ]);
	expect(names(mediaService, room([ 'DACH' ]), peerAt(warsaw, 'PL'))).toEqual([ 'berlin' ]);
	expect(names(mediaService, room([ 'AFRICA' ]), peerAt(warsaw, 'PL'))).toEqual([ 'lagos' ]);
});

test('keeps the sticky node first when it is within the distance threshold', () => {
	const { mediaService, nodes } = createService(europe);
	const stickyRoom = room();

	stickyRoom.mediaNodes.add(nodes.helsinki);

	expect(names(mediaService, stickyRoom, peerAt(warsaw))).toEqual([ 'helsinki', 'poznan', 'prague', 'berlin', 'lagos' ]);
});

test('breaks stickiness when the sticky node is far and a much closer node exists', () => {
	const { mediaService, nodes } = createService(europe);
	const stickyRoom = room();

	stickyRoom.mediaNodes.add(nodes.lagos);

	expect(names(mediaService, stickyRoom, peerAt(warsaw))[0]).toBe('poznan');
});

test('drops unhealthy and draining nodes, and keeps overloaded ones only as a last resort', () => {
	const { mediaService } = createService([
		{ name: 'poznan', country: 'PL', position: [ 52.41, 16.93 ], healthy: false },
		{ name: 'berlin', country: 'DE', position: [ 52.52, 13.40 ], draining: true },
		{ name: 'prague', country: 'CZ', position: [ 50.08, 14.44 ], load: 80 },
		{ name: 'helsinki', country: 'FI', position: [ 60.17, 24.94 ] },
	]);

	expect(names(mediaService, room(), peerAt(warsaw))).toEqual([ 'helsinki', 'prague' ]);
});

test('excluded nodes disappear from every list and the rest keep their order', () => {
	const { mediaService, nodes } = createService(europe);
	const stickyRoom = room();

	stickyRoom.mediaNodes.add(nodes.helsinki);

	expect(names(mediaService, stickyRoom, peerAt(warsaw, 'PL'), new Set([ nodes.helsinki, nodes.poznan ])))
		.toEqual([ 'prague', 'berlin', 'lagos' ]);
});
