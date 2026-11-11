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

describe('a peer that reconnects again and again without answering mediaConfiguration', () => {
	test('makes the media node answer once per retry interval, however often it reconnects', async () => {
		const room = makeRoom(new FakeRouter('a'));
		const peer = makePeer();
		const getRouter = (room.mediaService as unknown as { getRouter: jest.Mock }).getRouter;

		jest.spyOn(peer, 'request').mockRejectedValue(new Error('no answer'));

		// Fifty seconds of reconnects, ten a second, each starting an assignment as reconnectPeer does.
		for (let i = 0; i < 500; i++) {
			void assignRouter(room, peer);
			await jest.advanceTimersByTimeAsync(100);
		}

		expect(getRouter.mock.calls.length).toBeLessThanOrEqual(6);
		expect(getRouter.mock.calls.length).toBeGreaterThanOrEqual(4);
	});

	test('an assignment replaced while it waited on the client neither assigns nor retries', async () => {
		const room = makeRoom(new FakeRouter('a'));
		const peer = makePeer();
		const getRouter = (room.mediaService as unknown as { getRouter: jest.Mock }).getRouter;
		// eslint-disable-next-line no-unused-vars
		let answerOld: (value: unknown) => void = () => undefined;
		const notify = peer.notify as jest.Mock;

		jest.spyOn(peer, 'request')
			.mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }))
			.mockResolvedValue({ rtpCapabilities: { codecs: [] } });

		void assignRouter(room, peer);
		await jest.advanceTimersByTimeAsync(0);
		void assignRouter(room, peer); // the reconnect

		answerOld({ rtpCapabilities: { codecs: [] } });
		await jest.advanceTimersByTimeAsync(0);

		// The old answer came for a replaced assignment: no router from it, no noMediaServer.
		expect(peer.router).toBeUndefined();
		expect(notify).not.toHaveBeenCalledWith({ method: 'noMediaServer' });
		expect(getRouter).toHaveBeenCalledTimes(1);

		// The new one asks the media node once the retry interval since the old attempt is over.
		await jest.advanceTimersByTimeAsync(10_000);
		expect(getRouter).toHaveBeenCalledTimes(2);
		expect(peer.router).toBeDefined();
	});

	test('a reconnect after a router was assigned gets one again at once', async () => {
		const room = makeRoom(new FakeRouter('a'));
		const peer = makePeer();
		const getRouter = (room.mediaService as unknown as { getRouter: jest.Mock }).getRouter;

		jest.spyOn(peer, 'request').mockResolvedValue({ rtpCapabilities: { codecs: [] } });

		await assignRouter(room, peer);
		expect(peer.router).toBeDefined();

		peer.routerReset(true);
		await assignRouter(room, peer);
		expect(getRouter).toHaveBeenCalledTimes(2);
	});
});

describe('the router of an assignment that a reconnect replaced', () => {
	test('is owned by the room and closes with it', async () => {
		const late = new FakeRouter('late');
		const room = makeRoom(new FakeRouter('current'));
		const peer = makePeer();
		const getRouter = (room.mediaService as unknown as { getRouter: jest.Mock }).getRouter;
		// eslint-disable-next-line no-unused-vars
		let answerOld: (value: unknown) => void = () => undefined;

		getRouter.mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }));
		jest.spyOn(peer, 'request').mockRejectedValue(new Error('no answer'));

		const old = assignRouter(room, peer);

		// The first assignment asks the media node; then the reconnect replaces it.
		await jest.advanceTimersByTimeAsync(0);
		void assignRouter(room, peer);

		answerOld([ late, mediaNode ]);
		await old;

		room.close();

		expect(late.closed).toBe(true);
	});
});
