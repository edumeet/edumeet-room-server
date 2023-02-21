import { GeoStrategy } from '../../../src/loadbalance/GeoStrategy';
import MediaNode from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';

const mediaNodeRemote = {
	hostname: '1.1.128.50'
} as unknown as MediaNode;
const mediaNodeClose = {
	hostname: '2.248.0.10'
} as unknown as MediaNode;
const mediaNodeMiddle = {
	hostname: '194.177.32.0'
} as unknown as MediaNode;
const client = '5.44.192.0';
const clientLocalhost = '127.0.0.1';

test('Should not suggest remote media node', () => {
	const stickyCandidates = [ mediaNodeRemote ];
	const allNodes = [ mediaNodeRemote, mediaNodeClose, mediaNodeMiddle ];
	const peer = { getAddress: () => { return client; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates[1]).toBe(mediaNodeMiddle);
	expect(candidates[2]).toBe(mediaNodeRemote);
});

test('Should use sticky node within threshold', () => {
	const stickyCandidates = [ mediaNodeClose ];
	const allNodes = [ mediaNodeRemote, mediaNodeClose, mediaNodeMiddle ];
	const peer = { getAddress: () => { return client; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(1);
});

test('Should use closest media-node on two active nodes within threshold', () => {
	const stickyCandidates = [ mediaNodeMiddle, mediaNodeClose ];
	const allNodes = [ mediaNodeRemote, mediaNodeClose, mediaNodeMiddle ];
	const peer = { getAddress: () => { return client; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(2);
});

test('Should use closest media-node on no active nodes', () => {
	const stickyCandidates: MediaNode[] = [];
	const allNodes = [ mediaNodeRemote, mediaNodeClose, mediaNodeMiddle ];
	const peer = { getAddress: () => { return client; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeClose);
	expect(candidates.length).toBe(3);
});

test('Should use media-node outside of threshold when no other available', () => {
	const stickyCandidates: MediaNode[] = [];
	const allNodes = [ mediaNodeRemote ];
	const peer = { getAddress: () => { return client; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeRemote);
	expect(candidates.length).toBe(1);
});

test('Should keep sticky candidates when geoposition does not work', () => {
	const stickyCandidates = [ mediaNodeRemote ];
	const allNodes = [ mediaNodeClose, mediaNodeRemote ];
	const peer = { getAddress: () => { return clientLocalhost; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeRemote);
	expect(candidates.length).toBe(1);
});

test('Should use first media-node when geoposition does not work', () => {
	const stickyCandidates: MediaNode[] = [ ];
	const allNodes = [ mediaNodeRemote, mediaNodeClose ];
	const peer = { getAddress: () => { return clientLocalhost; } } as unknown as Peer;

	const sut = new GeoStrategy();

	const candidates = sut.getCandidates(allNodes, stickyCandidates, peer);

	expect(candidates[0]).toBe(mediaNodeRemote);
	expect(candidates.length).toBe(2);
});