import { KDPoint, KDTree } from 'edumeet-common';
import GeoStrategy from '../../../src/loadbalancing/GeoStrategy';
import { Peer } from '../../../src/Peer';

const pointRemote = new KDPoint([ 16.8833, 101.8833 ]);
const pointClose = new KDPoint([ 59.8376, 13.143 ]);
const pointMiddle = new KDPoint([ 48.8543, 2.3527 ]);

const clientDirect = { address: '5.44.192.0', forwardedFor: undefined };
const clientReverseProxy = { address: '10.244.0.1', forwardedFor: '5.44.192.0' };
const clientLocalhost = { address: '127.0.0.1' };

test('Should filter media node outside threshold (direct)', () => {
	const sut = new GeoStrategy(pointClose);
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const peerPosition = sut.getClientPosition(peer);

	const candidates = sut.filterOnThreshold([ pointRemote, pointMiddle ], peerPosition);

	expect(candidates.length).toBe(1);
	expect(candidates[0]).toBe(pointMiddle);
});

test('Should filter media node outside threshold (reverse proxy))', () => {
	const peer = { getAddress: () => { return clientReverseProxy; } } as unknown as Peer;
	const sut = new GeoStrategy(pointClose);
	const peerPosition = sut.getClientPosition(peer);

	const candidates = sut.filterOnThreshold([ pointRemote ], peerPosition);

	expect(candidates.length).toBe(0);
});

test('Should not filter media-node within threshold (direct)', () => {
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;

	const sut = new GeoStrategy(pointClose);
	const peerPosition = sut.getClientPosition(peer);

	const candidates = sut.filterOnThreshold([ pointClose ], peerPosition);

	expect(candidates[0]).toBe(pointClose);
	expect(candidates.length).toBe(1);
});

test('Should not filter media-node within threshold (reverse proxy)', () => {
	const peer = { getAddress: () => { return clientReverseProxy; } } as unknown as Peer;

	const sut = new GeoStrategy(pointClose);
	const peerPosition = sut.getClientPosition(peer);

	const candidates = sut.filterOnThreshold([ pointClose ], peerPosition);

	expect(candidates[0]).toBe(pointClose);
	expect(candidates.length).toBe(1);
});

test('Should fallback to default on failing geoip lookup', () => {
	const peer = { getAddress: () => { return clientLocalhost; } } as unknown as Peer;

	const sut = new GeoStrategy(pointClose);
	const peerPosition = sut.getClientPosition(peer);

	const candidates = sut.filterOnThreshold(
		[ pointRemote, pointClose ]
		, peerPosition
	);

	expect(candidates[0]).toBe(pointClose);
	expect(candidates.length).toBe(1);
});

test('Should return points from args on error', () => {
	const peer = { getAddress: () => { return clientLocalhost; } } as unknown as Peer;

	jest.spyOn(KDTree, 'getDistance').mockImplementation(() => {
		throw Error();
	});
	const sut = new GeoStrategy(pointClose);
	const peerPosition = sut.getClientPosition(peer);

	const candidates = sut.filterOnThreshold(
		[ pointRemote, pointClose ]
		, peerPosition
	);

	expect(candidates[0]).toBe(pointRemote);
	expect(candidates[1]).toBe(pointClose);
	expect(candidates.length).toBe(2);
});
