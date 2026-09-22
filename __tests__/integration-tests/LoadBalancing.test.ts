import 'jest';
import { KDPoint, KDTree } from 'edumeet-common';
import MediaService from '../../src/MediaService';
import { MediaNode } from '../../src/media/MediaNode';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';

/**
 * Candidate selection through the real Room, which is what holds a room's media nodes
 * and decides what stickiness means. What the ordering rules are in isolation is
 * covered by the unit suite (MediaService.getCandidates).
 *
 * The client position falls back to the service default, since a loopback address has
 * no location: every distance below is measured from there.
 */

const HERE = [ 50, 10 ];
const NEARBY = [ 50.5, 10 ];
const FAR_AWAY = [ 16, 101 ]; // several thousand kilometres, well past the distance threshold

const node = (id: string, position: number[], { load = 0, healthy = true } = {}): MediaNode => ({
	id,
	hostname: `${id}.invalid`,
	port: 3443,
	healthy,
	draining: false,
	load,
	kdPoint: new KDPoint(position),
	close: () => undefined
}) as unknown as MediaNode;

const serviceWith = (nodes: MediaNode[]): MediaService => {
	const kdTree = new KDTree([]);

	nodes.forEach((mediaNode) => kdTree.addNode(new KDPoint(mediaNode.kdPoint.position, { mediaNode })));
	kdTree.rebalance();

	return new MediaService({ kdTree, mediaNodes: [], defaultClientPosition: new KDPoint(HERE) });
};

const ask = (mediaService: MediaService, sticky?: MediaNode): { candidates: MediaNode[], room: Room, peer: Peer } => {
	const room = new Room({ id: 'roomId', name: 'name', tenantId: 1, mediaService });
	const peer = new Peer({ id: 'peerId', sessionId: room.sessionId, reconnectKey: 'key' });

	// A peer only learns its address from its signaling connection, which this suite has none of.
	jest.spyOn(peer, 'getAddress').mockReturnValue({ address: '127.0.0.1', forwardedFor: undefined });

	if (sticky) room.addMediaNode(sticky);

	return { candidates: mediaService.getCandidates(mediaService.kdTree, room, peer), room, peer };
};

const done = (mediaService: MediaService, room: Room, peer: Peer): void => {
	peer.close();
	room.close();
	mediaService.close();
};

test('a room stays on the media node it is already on', () => {
	const inUse = node('inUse', NEARBY);
	const nearer = node('nearer', HERE);
	const sut = serviceWith([ inUse, nearer ]);

	const { candidates, room, peer } = ask(sut, inUse);

	expect(candidates[0]).toBe(inUse);
	expect(candidates).toContain(nearer);

	done(sut, room, peer);
});

test('a room leaves a media node that is far away when a much closer one is free', () => {
	const inUse = node('inUse', FAR_AWAY);
	const nearer = node('nearer', HERE);
	const sut = serviceWith([ inUse, nearer ]);

	const { candidates, room, peer } = ask(sut, inUse);

	expect(candidates[0]).toBe(nearer);
	expect(candidates.indexOf(inUse)).toBeGreaterThan(0);

	done(sut, room, peer);
});

test('a media node under heavy load is the last thing offered, even to a room already on it', () => {
	const busy = node('busy', HERE, { load: 90 });
	const quiet = node('quiet', NEARBY);
	const sut = serviceWith([ busy, quiet ]);

	const { candidates, room, peer } = ask(sut, busy);

	expect(candidates[0]).toBe(quiet);
	expect(candidates.at(-1)).toBe(busy);

	done(sut, room, peer);
});

test('an unhealthy media node is not offered at all, not even as a last resort', () => {
	const down = node('down', HERE, { healthy: false });
	const sut = serviceWith([ down ]);

	const { candidates, room, peer } = ask(sut, down);

	expect(candidates).toEqual([]);

	done(sut, room, peer);
});
