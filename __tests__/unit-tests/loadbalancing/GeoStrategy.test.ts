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