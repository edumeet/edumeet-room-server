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
		const peer = { id: 'p1', closed: false, routerReady: Promise.resolve([ undefined, { createWebRtcTransport } ]), notify: jest.fn() };
		const room = { sessionId: 's1', peers: { has: () => false } } as unknown as Room;
		const sut = createInitialMediaMiddleware({ room });
		const request = () => sut(context(peer, 'createWebRtcTransport', { sessionId: 's1', producing: true, consuming: false }), next);

		const first = request();
		const second = request();

		await expect(second).rejects.toThrow('cannot create more than one producing');
		release();
		await first;

		expect(createWebRtcTransport).toHaveBeenCalledTimes(1);
		await expect(request()).rejects.toThrow('cannot create more than one producing');
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
