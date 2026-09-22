import 'jest';
import { KDPoint, KDTree } from 'edumeet-common';
import MediaService from '../../../src/MediaService';
import { MediaNode } from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import { startFakeMediaNode, startSilentPort } from './fakeMediaNode';

/**
 * No external dependencies: the media nodes this suite talks to are servers it starts
 * itself on free ports.
 */

jest.setTimeout(60000);

const serviceWith = (nodes: MediaNode[]): MediaService => {
	const kdTree = new KDTree([]);

	nodes.forEach((mediaNode) => kdTree.addNode(new KDPoint(mediaNode.kdPoint.position, { mediaNode })));
	kdTree.rebalance();

	return new MediaService({ kdTree, mediaNodes: [], defaultClientPosition: new KDPoint([ 50, 10 ]) });
};

const roomAndPeer = (mediaService: MediaService): { room: Room, peer: Peer } => {
	const room = new Room({ id: 'roomId', name: 'name', tenantId: 1, mediaService });
	const peer = new Peer({ id: 'peerId', sessionId: room.sessionId, reconnectKey: 'key' });

	// A peer only learns its address from its signaling connection, which this suite has none of.
	jest.spyOn(peer, 'getAddress').mockReturnValue({ address: '127.0.0.1', forwardedFor: undefined });

	return { room, peer };
};

test('every node that keeps answering with an error is asked once per round, for three rounds, then the peer is told', async () => {
	// A node that answers at all stays healthy, so only the round bound stops the retrying.
	const fake = await startFakeMediaNode({ onRequest: (_request, respond) => respond('Server error', null) });
	const nodes = [ 0, 1, 2, 3, 4, 5 ].map((index) => new MediaNode({
		id: `mediaNode${index}`,
		hostname: fake.host,
		port: fake.port,
		secret: 'secret',
		turnports: [],
		kdPoint: new KDPoint([ 50 + index, 10 ])
	}));
	const asks = nodes.map((mediaNode) => jest.spyOn(mediaNode, 'getRouter'));
	const sut = serviceWith(nodes);
	const { room, peer } = roomAndPeer(sut);
	const offered = jest.spyOn(sut, 'getCandidates');

	await expect(sut.getRouter(room, peer)).rejects.toThrow('no media nodes available');

	asks.forEach((ask, index) => expect([ index, ask.mock.calls.length ]).toEqual([ index, 3 ]));
	nodes.forEach((mediaNode) => expect(mediaNode.healthy).toBe(true));

	// The last thing candidate selection offered was nothing: a round ends when every
	// eligible node has been asked, rather than offering the same node twice.
	expect(offered.mock.results.at(-1)?.value).toEqual([]);

	peer.close();
	room.close();
	sut.close();
	await fake.close();
});

test('a node that cannot be reached is asked once, marked unhealthy, and not asked again', async () => {
	// The port accepts the socket and never speaks, so connecting times out.
	const silent = await startSilentPort();
	const mediaNode = new MediaNode({
		id: 'mediaNodeId',
		hostname: silent.host,
		port: silent.port,
		secret: 'secret',
		turnports: [],
		kdPoint: new KDPoint([ 50, 10 ])
	});
	const ask = jest.spyOn(mediaNode, 'getRouter');
	const sut = serviceWith([ mediaNode ]);
	const { room, peer } = roomAndPeer(sut);

	await expect(sut.getRouter(room, peer)).rejects.toThrow('no media nodes available');

	expect(ask.mock.calls.length).toBeLessThanOrEqual(1);
	expect(mediaNode.healthy).toBe(false);

	peer.close();
	room.close();
	sut.close();
	await silent.close();
});
