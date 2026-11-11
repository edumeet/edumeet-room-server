import 'jest';
import { createMediaMiddleware } from '../../../src/middlewares/mediaMiddleware';
import { createInitialMediaMiddleware } from '../../../src/middlewares/initialMediaMiddleware';
import { createDrawingMiddleware } from '../../../src/middlewares/drawingMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

const context = (peer: unknown, method: string, data: unknown) =>
	({ peer, message: { method, data }, response: {}, handled: false }) as unknown as PeerContext;

describe('producers per source', () => {
	const setup = (source: string, existing: number, reused = false) => {
		const producer = { id: 'new', appData: { source }, once: jest.fn(), on: jest.fn(), close: jest.fn() };
		const produceDeduped = jest.fn(async () => ({ producer, reused }));
		const peer = {
			id: 'p1',
			hasPermission: jest.fn(() => true),
			producingTransport: { produceDeduped },
			producers: new Map(Array.from({ length: existing }, (_, i) => [ `old${i}`, { appData: { source } } ])),
			notify: jest.fn(),
		};
		const room = { sessionId: 's1', getPeers: jest.fn(() => []) } as unknown as Room;
		const ctx = context(peer, 'produce', { sessionId: 's1', kind: 'audio', rtpParameters: { encodings: [] }, appData: { source } });

		return { sut: createMediaMiddleware({ room }), ctx, producer, room };
	};

	test('refuses a third microphone producer and closes it', async () => {
		const { sut, ctx, producer, room } = setup('mic', 2);

		await expect(sut(ctx, next)).rejects.toThrow('too many producers');
		expect(producer.close).toHaveBeenCalled();
		expect(room.getPeers).not.toHaveBeenCalled();
	});

	test('allows a second microphone producer during a device switch', async () => {
		const { sut, ctx, producer } = setup('mic', 1);

		await sut(ctx, next);
		expect(producer.close).not.toHaveBeenCalled();
		expect(ctx.handled).toBe(true);
	});

	test('still answers a retried request with its existing producer', async () => {
		const { sut, ctx, producer } = setup('mic', 2, true);

		await sut(ctx, next);
		expect(producer.close).not.toHaveBeenCalled();
		expect(ctx.response).toEqual({ id: 'new' });
	});

	test('allows several extra videos, up to a limit', async () => {
		await setup('extravideo', 7).sut(setup('extravideo', 7).ctx, next);
		await expect(setup('extravideo', 8).sut(setup('extravideo', 8).ctx, next)).rejects.toThrow('too many producers');
	});

	test('counts data producers still being created against the limit', async () => {
		let release: () => void = () => undefined;
		const answered = new Promise<void>((resolve) => (release = resolve));
		const produceData = jest.fn(async () => {
			await answered;

			return { id: `d${Math.random()}`, label: 'x', appData: {}, once: jest.fn() };
		});
		const peer = { id: 'p1', producingTransport: { produceData }, dataProducers: new Map() };
		const room = { sessionId: 's1', getPeers: jest.fn(() => []) } as unknown as Room;
		const sut = createMediaMiddleware({ room });
		const request = () => sut(context(peer, 'produceData', { sessionId: 's1', sctpStreamParameters: {}, label: 'x', protocol: '', appData: {} }), next);

		const burst: Promise<string>[] = Array.from({ length: 9 }, () => Promise.resolve(request()).then(() => 'ok', (e: Error) => e.message));

		release();

		const results = await Promise.all(burst);

		expect(produceData).toHaveBeenCalledTimes(8);
		expect(results.filter((r) => r === 'too many data producers')).toHaveLength(1);
	});

	test('refuses data producers beyond the limit', async () => {
		const produceData = jest.fn();
		const peer = {
			id: 'p1',
			producingTransport: { produceData },
			dataProducers: new Map(Array.from({ length: 8 }, (_, i) => [ `d${i}`, {} ])),
		};
		const room = { sessionId: 's1', getPeers: jest.fn(() => []) } as unknown as Room;
		const ctx = context(peer, 'produceData', { sessionId: 's1', sctpStreamParameters: {}, label: 'x', protocol: '', appData: {} });

		await expect(createMediaMiddleware({ room })(ctx, next)).rejects.toThrow('too many data producers');
		expect(produceData).not.toHaveBeenCalled();
	});
});

describe('concurrent createWebRtcTransport', () => {
	test('creates one transport per direction, however many requests arrive at once', async () => {
		let release: () => void = () => undefined;
		const answered = new Promise<void>((resolve) => (release = resolve));
		const transport = { id: 't1', once: jest.fn(), close: jest.fn() };
		const createWebRtcTransport = jest.fn(async () => {
			await answered;

			return transport;
		});
		const peer = { id: 'p1', closed: false, routerReady: Promise.resolve([ undefined, { createWebRtcTransport } ]), notify: jest.fn() } as Record<string, unknown>;
		const room = { sessionId: 's1', peers: { has: () => false } } as unknown as Room;
		const sut = createInitialMediaMiddleware({ room });
		const request = () => context(peer, 'createWebRtcTransport', { sessionId: 's1', producing: true, consuming: false });

		// The second one is what a client sends when the answer to the first takes too long.
		const first = request();
		const second = request();
		const both = Promise.all([ sut(first, next), sut(second, next) ]);

		release();
		await both;

		expect(createWebRtcTransport).toHaveBeenCalledTimes(1);
		expect(first.response).toMatchObject({ id: 't1' });
		expect(second.response).toMatchObject({ id: 't1' });
		expect(first.handled).toBe(true);
		expect(second.handled).toBe(true);
		expect(peer.producingTransport).toBe(transport);
		expect(transport.once).toHaveBeenCalledTimes(1);
		expect(transport.close).not.toHaveBeenCalled();
		await expect(sut(request(), next)).rejects.toThrow('cannot create more than one producing');
	});

	test('answers every waiting request when the creation fails, and the next request starts a new one', async () => {
		let fail: () => void = () => undefined;
		const failed = new Promise<void>((resolve) => (fail = resolve));
		const transport = { id: 't2', once: jest.fn(), close: jest.fn() };
		const createWebRtcTransport = jest.fn()
			.mockImplementationOnce(async () => {
				await failed;

				throw new Error('media node gone');
			})
			.mockImplementationOnce(async () => transport);
		const peer = { id: 'p1', closed: false, routerReady: Promise.resolve([ undefined, { createWebRtcTransport } ]), notify: jest.fn() } as Record<string, unknown>;
		const room = { sessionId: 's1', peers: { has: () => false } } as unknown as Room;
		const sut = createInitialMediaMiddleware({ room });
		const request = () => context(peer, 'createWebRtcTransport', { sessionId: 's1', producing: false, consuming: true });

		const results = Promise.all([ sut(request(), next), sut(request(), next) ].map((sent) => Promise.resolve(sent).then(() => 'ok', (e: Error) => e.message)));

		fail();
		expect(await results).toEqual([ 'media node gone', 'media node gone' ]);
		expect(peer.consumingTransport).toBeUndefined();

		const again = request();

		await sut(again, next);
		expect(again.response).toMatchObject({ id: 't2' });
		expect(createWebRtcTransport).toHaveBeenCalledTimes(2);
	});

	test('keeps the directions apart: one transport each for requests sent together', async () => {
		const transports = [ { id: 'send', once: jest.fn(), close: jest.fn() }, { id: 'recv', once: jest.fn(), close: jest.fn() } ];
		const createWebRtcTransport = jest.fn()
			.mockImplementationOnce(async () => transports[0])
			.mockImplementationOnce(async () => transports[1]);
		const peer = { id: 'p1', closed: false, routerReady: Promise.resolve([ undefined, { createWebRtcTransport } ]), notify: jest.fn() } as Record<string, unknown>;
		const room = { sessionId: 's1', peers: { has: () => false } } as unknown as Room;
		const sut = createInitialMediaMiddleware({ room });
		const send = context(peer, 'createWebRtcTransport', { sessionId: 's1', producing: true, consuming: false });
		const recv = context(peer, 'createWebRtcTransport', { sessionId: 's1', producing: false, consuming: true });

		await Promise.all([ sut(send, next), sut(recv, next) ]);

		expect(send.response).toMatchObject({ id: 'send' });
		expect(recv.response).toMatchObject({ id: 'recv' });
		expect(peer.producingTransport).toBe(transports[0]);
		expect(peer.consumingTransport).toBe(transports[1]);
	});

	test('closes a transport whose request began on a replaced connection, and lets the new one create its own', async () => {
		let release: () => void = () => undefined;
		const answered = new Promise<void>((resolve) => (release = resolve));
		const stale = { id: 'stale', once: jest.fn(), close: jest.fn() };
		const fresh = { id: 'fresh', once: jest.fn(), close: jest.fn() };
		const createWebRtcTransport = jest.fn()
			.mockImplementationOnce(async () => {
				await answered;

				return stale;
			})
			.mockImplementationOnce(async () => fresh);
		const peer = { id: 'p1', closed: false, connectionGeneration: 0, routerReady: Promise.resolve([ undefined, { createWebRtcTransport } ]), notify: jest.fn() } as Record<string, unknown>;
		const room = { sessionId: 's1', peers: { has: () => false } } as unknown as Room;
		const sut = createInitialMediaMiddleware({ room });
		const request = () => sut(context(peer, 'createWebRtcTransport', { sessionId: 's1', producing: true, consuming: false }), next);

		const before = request();

		peer.connectionGeneration = 1; // the client reconnected
		await request();
		expect(peer.producingTransport).toBe(fresh);

		release();
		await expect(before).rejects.toThrow('connection replaced');
		expect(stale.close).toHaveBeenCalled();
		expect(peer.producingTransport).toBe(fresh);
	});

	test('closes a transport that arrives after the peer left', async () => {
		const transport = { id: 't1', once: jest.fn(), close: jest.fn() };
		const peer = { id: 'p1', closed: true, routerReady: Promise.resolve([ undefined, { createWebRtcTransport: jest.fn(async () => transport) } ]) };
		const room = { sessionId: 's1', peers: { has: () => false } } as unknown as Room;

		await expect(createInitialMediaMiddleware({ room })(context(peer, 'createWebRtcTransport', { sessionId: 's1', consuming: true }), next))
			.rejects.toThrow('peer closed');
		expect(transport.close).toHaveBeenCalled();
	});
});

describe('whiteboard background colour', () => {
	const setup = () => {
		const room = { sessionId: 's1', notifyPeers: jest.fn(), drawing: { isEnabled: true, bgColor: 'white', canvasState: [] } };

		return { room, send: (data: unknown) => createDrawingMiddleware({ room: room as unknown as Room })(context({}, 'setDrawingBgColor', data), next) };
	};

	test('refuses a colour the client does not offer', async () => {
		const { room, send } = setup();

		await expect(send({})).rejects.toThrow('invalid background colour');
		await expect(send('red')).rejects.toThrow('invalid background colour');
		expect(room.notifyPeers).not.toHaveBeenCalled();
		expect(room.drawing.bgColor).toBe('white');
	});

	test('forwards a change once, and an unchanged colour not at all', async () => {
		const { room, send } = setup();

		await send('black');
		await send('black');
		expect(room.notifyPeers).toHaveBeenCalledTimes(1);
		expect(room.drawing.bgColor).toBe('black');
	});
});
