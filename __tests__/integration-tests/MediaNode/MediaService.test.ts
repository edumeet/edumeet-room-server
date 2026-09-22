import 'jest';
import { KDPoint, KDTree, SocketMessage } from 'edumeet-common';
import MediaService from '../../../src/MediaService';
import { MediaNode } from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import { startFakeMediaNode } from './fakeMediaNode';

/**
 * No external dependencies: the media node this suite talks to is a socket.io server it
 * starts itself on a free port.
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

test('a deployment with no media nodes tells the peer there is no media server', async () => {
	const sut = serviceWith([]);
	const { room, peer } = roomAndPeer(sut);

	await expect(sut.getRouter(room, peer)).rejects.toThrow('no media nodes available');

	peer.close();
	room.close();
	sut.close();
});

test('a peer gets a router from the media node, asked for by the session of its room', async () => {
	const asked: SocketMessage[] = [];
	const fake = await startFakeMediaNode({
		onRequest: (request, respond) => {
			asked.push(request);
			respond(null, { id: 'routerId', rtpCapabilities: {} });
		}
	});
	const mediaNode = new MediaNode({
		id: 'mediaNodeId',
		hostname: fake.host,
		port: fake.port,
		secret: 'secret',
		turnports: [],
		kdPoint: new KDPoint([ 50, 10 ])
	});
	const sut = serviceWith([ mediaNode ]);
	const { room, peer } = roomAndPeer(sut);

	const [ router, servedBy ] = await sut.getRouter(room, peer);

	expect(servedBy).toBe(mediaNode);
	expect(router.id).toBe('routerId');
	expect(router.closed).toBe(false);
	expect(router.appData).toHaveProperty('pipePromises');

	// The room is asked for by its session, not by its name: a room reopened under the
	// same name is a new session on the media node.
	expect(asked.map((request) => request.method)).toContain('getRouter');
	expect(asked[0].data?.roomId).toBe(room.sessionId);

	router.close();
	peer.close();
	room.close();
	sut.close();
	await fake.close();
});
