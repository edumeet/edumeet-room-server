import 'jest';
import { KDPoint, KDTree } from 'edumeet-common';
import MediaService from '../../../src/MediaService';
import { MediaNode } from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import { FakeMediaNode, RequestHandler, startFakeMediaNode } from './fakeMediaNode';

/**
 * No external dependencies: every media node in this suite is a socket.io server it
 * starts itself on a free port.
 */

jest.setTimeout(60000);

const serves: RequestHandler = (request, respond) =>
	respond(null, { id: `router-${request.data?.roomId}`, rtpCapabilities: {} });

const refuses: RequestHandler = (_request, respond) => respond('Server error', null);

const nodeAt = (fake: FakeMediaNode, id: string, position: number[]): MediaNode => new MediaNode({
	id,
	hostname: fake.host,
	port: fake.port,
	secret: 'secret',
	turnports: [],
	kdPoint: new KDPoint(position)
});

test('a candidate that answers with an error is passed over for the next one, and the rest are left alone', async () => {
	// The nearest node refuses, the second serves, the third must never be asked.
	const failing = await startFakeMediaNode({ onRequest: refuses });
	const working = await startFakeMediaNode({ onRequest: serves });
	const spare = await startFakeMediaNode({ onRequest: serves });

	const first = nodeAt(failing, 'first', [ 50, 10 ]);
	const second = nodeAt(working, 'second', [ 51, 10 ]);
	const third = nodeAt(spare, 'third', [ 60, 10 ]);

	const askFirst = jest.spyOn(first, 'getRouter');
	const askSecond = jest.spyOn(second, 'getRouter');
	const askThird = jest.spyOn(third, 'getRouter');

	const kdTree = new KDTree([]);

	[ first, second, third ].forEach((mediaNode) => kdTree.addNode(new KDPoint(mediaNode.kdPoint.position, { mediaNode })));
	kdTree.rebalance();

	const sut = new MediaService({ kdTree, mediaNodes: [], defaultClientPosition: new KDPoint([ 50, 10 ]) });
	const room = new Room({ id: 'roomId', name: 'name', tenantId: 1, mediaService: sut });
	const peer = new Peer({ id: 'peerId', sessionId: room.sessionId, reconnectKey: 'key' });

	// A peer only learns its address from its signaling connection, which this suite has none of.
	jest.spyOn(peer, 'getAddress').mockReturnValue({ address: '127.0.0.1', forwardedFor: undefined });

	const [ router, mediaNode ] = await sut.getRouter(room, peer);

	expect(mediaNode).toBe(second);
	expect(router.closed).toBe(false);
	expect(router.appData).toHaveProperty('pipePromises');

	expect(askFirst).toHaveBeenCalled();
	expect(askSecond).toHaveBeenCalled();
	expect(askThird).not.toHaveBeenCalled();

	// A node that answers at all is reachable: an error is the room's problem, not the node's.
	expect(first.healthy).toBe(true);

	peer.close();
	room.close();
	sut.close();
	await Promise.all([ failing.close(), working.close(), spare.close() ]);
});
