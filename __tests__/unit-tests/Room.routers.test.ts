import 'jest';
import { EventEmitter } from 'events';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import { Router } from '../../src/media/Router';
import { MediaNode } from '../../src/media/MediaNode';

class FakeRouter extends EventEmitter {
	public closed = false;
	public rtpCapabilities: { codecs: unknown[] } = { codecs: [] };
	public id: string;

	constructor(id: string) {
		super();
		this.id = id;
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.emit('close');
	}
}

const asRouter = (router: FakeRouter) => router as unknown as Router;
const mediaNode = { hostname: 'node1.example.org' } as unknown as MediaNode;

const created: Peer[] = [];

const makePeer = (): Peer => {
	const peer = new Peer({ id: `p-${created.length}`, sessionId: 's', reconnectKey: 'k' });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const makeRoom = (router?: FakeRouter): Room => new Room({
	id: 'r',
	tenantId: 1,
	mediaService: { getRouter: jest.fn().mockResolvedValue([ router, mediaNode ]) } as unknown as MediaService
});

const assignRouter = (room: Room, peer: Peer): Promise<void> =>
	Reflect.get(room, 'assignRouter').call(room, peer);

beforeEach(() => jest.useFakeTimers());

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
	jest.clearAllTimers();
	jest.useRealTimers();
});

test('closing the room closes every router, not every other one', () => {
	const room = makeRoom();
	const routers = [ new FakeRouter('a'), new FakeRouter('b'), new FakeRouter('c') ];

	routers.forEach((r) => room.addRouter(asRouter(r)));

	room.close();

	expect(routers.map((r) => r.closed)).toEqual([ true, true, true ]);
});

test('a router whose peer never answers mediaConfiguration still closes with the room', async () => {
	const router = new FakeRouter('a');
	const room = makeRoom(router);
	const peer = makePeer();

	jest.spyOn(peer, 'request').mockRejectedValue(new Error('request() no connection available'));

	await assignRouter(room, peer);

	expect(peer.router).toBeUndefined();
	expect(room.routers.has(asRouter(router))).toBe(true);

	room.close();

	expect(router.closed).toBe(true);
});

test('a room that closes while a peer is answering mediaConfiguration does not keep its router', async () => {
	const router = new FakeRouter('a');
	const room = makeRoom(router);
	const peer = makePeer();

	jest.spyOn(peer, 'request').mockImplementation(async () => {
		room.close();

		return { rtpCapabilities: { codecs: [] } };
	});

	await assignRouter(room, peer);

	expect(router.closed).toBe(true);
	expect(peer.router).toBeUndefined();
});

test('a router that closes while the peer is answering mediaConfiguration is replaced at once, without a reset', async () => {
	const router = new FakeRouter('a');
	const replacement = new FakeRouter('b');
	const room = makeRoom(router);
	const peer = makePeer();

	(room.mediaService.getRouter as jest.Mock).mockResolvedValueOnce([ router, mediaNode ]).mockResolvedValueOnce([ replacement, mediaNode ]);

	jest.spyOn(peer, 'request')
		.mockImplementationOnce(async () => {
			router.close();

			return { rtpCapabilities: { codecs: [] } };
		})
		.mockResolvedValueOnce({ rtpCapabilities: { codecs: [] } });

	const routerReady = peer.routerReady;

	await assignRouter(room, peer);

	expect(peer.notify).not.toHaveBeenCalledWith({ method: 'lostMediaServer' });
	expect(peer.notify).not.toHaveBeenCalledWith({ method: 'noMediaServer' });
	expect(peer.request).toHaveBeenCalledTimes(2);
	expect(peer.routerReady).toBe(routerReady);
	await expect(routerReady).resolves.toEqual([ null, asRouter(replacement) ]);
	expect(peer.router).toBe(asRouter(replacement));
	expect(room.routers.has(asRouter(router))).toBe(false);
	expect(room.routers.has(asRouter(replacement))).toBe(true);
});

test('a replacement router with other capabilities makes the client build a fresh device first', async () => {
	const router = new FakeRouter('a');
	const replacement = new FakeRouter('b');
	const room = makeRoom(router);
	const peer = makePeer();

	replacement.rtpCapabilities = { codecs: [ { kind: 'video', mimeType: 'video/VP8' } ] };
	(room.mediaService.getRouter as jest.Mock).mockResolvedValueOnce([ router, mediaNode ]).mockResolvedValueOnce([ replacement, mediaNode ]);

	const request = jest.spyOn(peer, 'request')
		.mockImplementationOnce(async () => {
			router.close();

			return { rtpCapabilities: { codecs: [] } };
		})
		.mockResolvedValueOnce({ rtpCapabilities: { codecs: [] } });

	await assignRouter(room, peer);

	const notify = peer.notify as jest.Mock;
	const lost = notify.mock.calls.findIndex(([ n ]) => n.method === 'lostMediaServer');

	expect(lost).not.toBe(-1);
	expect(notify.mock.invocationCallOrder[lost]).toBeLessThan(request.mock.invocationCallOrder[1]);
	expect(request.mock.calls[1][0]).toMatchObject({ data: { routerRtpCapabilities: replacement.rtpCapabilities } });
	expect(peer.notify).not.toHaveBeenCalledWith({ method: 'noMediaServer' });
	expect(peer.router).toBe(asRouter(replacement));
});

test('closing a room with peers on its routers leaves no timers behind', async () => {
	const routers = [ new FakeRouter('a'), new FakeRouter('b') ];
	const room = makeRoom();
	const peers = [ makePeer(), makePeer() ];

	(room.mediaService.getRouter as jest.Mock).mockResolvedValueOnce([ routers[0], mediaNode ]).mockResolvedValueOnce([ routers[1], mediaNode ]);

	for (const peer of peers) {
		jest.spyOn(peer, 'request').mockResolvedValue({ rtpCapabilities: { codecs: [] } });
		room.joinPeer(peer);
		await assignRouter(room, peer);
	}

	expect(peers.map((p) => p.router)).toEqual(routers.map(asRouter));

	room.close();

	expect(routers.every((r) => r.closed)).toBe(true);
	expect(peers.every((p) => p.closed)).toBe(true);
	expect(jest.getTimerCount()).toBe(0);
});

test('a peer admitted but not joined that reconnects gets a router again', async () => {
	const router = new FakeRouter('a');
	const room = makeRoom(router);
	const peer = makePeer();

	jest.spyOn(peer, 'request').mockResolvedValue({ rtpCapabilities: { codecs: [] } });
	room.pendingPeers.add(peer);
	await assignRouter(room, peer);
	expect(peer.router).toBe(asRouter(router));

	// What switchConnection does with the router of the connection that is gone.
	peer.routerReset(true);
	expect(peer.router).toBeUndefined();

	room.reconnectPeer(peer);

	await expect(peer.routerReady).resolves.toEqual([ null, asRouter(router) ]);
	expect(peer.router).toBe(asRouter(router));
	expect(peer.request).toHaveBeenCalledTimes(2);
});

test('a peer that answers mediaConfiguration gets the router', async () => {
	const router = new FakeRouter('a');
	const room = makeRoom(router);
	const peer = makePeer();

	jest.spyOn(peer, 'request').mockResolvedValue({ rtpCapabilities: { codecs: [] } });

	await assignRouter(room, peer);

	expect(peer.router).toBe(asRouter(router));
	expect(room.routers.has(asRouter(router))).toBe(true);
	expect(room.mediaNodes.has(mediaNode)).toBe(true);
});
