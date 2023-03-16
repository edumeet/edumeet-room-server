import GeoPosition from '../../../src/loadbalancing/GeoPosition';
import GeoStrategy from '../../../src/loadbalancing/GeoStrategy';
import MediaNode from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';

const mediaNodeRemote = {
	geoPosition: new GeoPosition({ latitude: 16.8833,	longitude: 101.8833 })
} as unknown as MediaNode;
const mediaNodeClose = {
	geoPosition: new GeoPosition({ latitude: 59.8376, longitude: 13.143 })
} as unknown as MediaNode;
const mediaNodeMiddle = {
	geoPosition: new GeoPosition({ latitude: 48.8543,	longitude: 2.3527 })
} as unknown as MediaNode;
const clientDirect = { address: '5.44.192.0', forwardedFor: undefined };
const clientReverseProxy = { address: '10.244.0.1', forwardedFor: '5.44.192.0' };
const clientLocalhost = { address: '127.0.0.1' };

test('Should filter media node outside threshold (direct)', () => {
	const stickyCandidates = [ mediaNodeRemote ];
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.filterOnThreshold(stickyCandidates, peer);

	expect(candidates.length).toBe(0);
});

test('Should filter media node outside threshold (reverse proxy))', () => {
	const stickyCandidates = [ mediaNodeRemote ];
	const peer = { getAddress: () => { return clientReverseProxy; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.filterOnThreshold(stickyCandidates, peer);

	expect(candidates.length).toBe(0);
});

test('Should not filter media-node within threshold (direct)', () => {
	const stickyCandidates = [ mediaNodeClose ];
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.filterOnThreshold(stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(1);
});

test('Should not filter media-node within threshold (reverse proxy)', () => {
	const stickyCandidates = [ mediaNodeClose ];
	const peer = { getAddress: () => { return clientReverseProxy; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.filterOnThreshold(stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(1);
});

test('Should sort media-nodes', () => {
	const stickyCandidates = [ mediaNodeMiddle, mediaNodeClose ];
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.sortOnDistance(stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(2);
});

test('Should return candidates when filter does not work', () => {
	const stickyCandidates = [ mediaNodeRemote, mediaNodeClose ];
	const peer = { getAddress: () => { return clientLocalhost; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.filterOnThreshold(stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeRemote);
	expect(candidates[1]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(2);
});

test('Should return candidates when sort does not work', () => {
	const stickyCandidates: MediaNode[] = [ mediaNodeRemote, mediaNodeClose ];
	const peer = { getAddress: () => { return clientLocalhost; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.sortOnDistance(stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeRemote);
	expect(candidates[1]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(2);
});