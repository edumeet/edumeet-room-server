import { createMediaMiddleware } from '../../../src/middlewares/mediaMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import { OBSERVER_SAMPLES_LABEL } from '../../../src/common/consuming';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

const produceDataContext = (label: string, endToEndEncryption: boolean, headless = false) => {
	const produceData = jest.fn(async (options: { label: string }) => ({
		id: 'dp1',
		label: options.label,
		appData: {},
		once: jest.fn(),
	}));
	const room = {
		sessionId: 's1',
		endToEndEncryption,
		getPeers: jest.fn(() => []),
	} as unknown as Room;
	const peer = {
		id: 'p1',
		headless,
		producingTransport: { produceData },
		dataProducers: new Map(),
	};
	const message = {
		method: 'produceData',
		data: { sessionId: 's1', sctpStreamParameters: {}, label, protocol: '', appData: {} },
	};
	const context = { peer, message, response: {}, handled: false } as unknown as PeerContext;

	return { sut: createMediaMiddleware({ room }), context, produceData, room };
};

const produceContext = (source: string, kind: string) => {
	const produceDeduped = jest.fn(async (options: { rtpParameters: { encodings: { ssrc: number, dtx?: boolean }[] } }) => ({
		options,
		producer: {
			id: 'prod1',
			appData: {},
			once: jest.fn(),
			on: jest.fn(),
		},
		reused: false,
	}));
	const room = {
		sessionId: 's1',
		getPeers: jest.fn(() => []),
	} as unknown as Room;
	const peer = {
		id: 'p1',
		hasPermission: jest.fn(() => true),
		producingTransport: { produceDeduped },
		producers: new Map(),
		notify: jest.fn(),
	};
	const rtpParameters = { encodings: [ { ssrc: 1 }, { ssrc: 2 } ] };
	const message = {
		method: 'produce',
		data: { sessionId: 's1', kind, rtpParameters, appData: { source } },
	};
	const context = { peer, message, response: {}, handled: false } as unknown as PeerContext;

	return { sut: createMediaMiddleware({ room }), context, produceDeduped, rtpParameters };
};

describe('produce dtx', () => {
	test('marks screen share video encodings as dtx', async () => {
		const { sut, context, produceDeduped } = produceContext('screen', 'video');

		await sut(context, next);

		expect(produceDeduped).toHaveBeenCalledTimes(1);
		expect(produceDeduped.mock.calls[0][0].rtpParameters.encodings)
			.toEqual([ { ssrc: 1, dtx: true }, { ssrc: 2, dtx: true } ]);
	});

	test('leaves webcam video encodings untouched', async () => {
		const { sut, context, produceDeduped } = produceContext('webcam', 'video');

		await sut(context, next);

		expect(produceDeduped.mock.calls[0][0].rtpParameters.encodings)
			.toEqual([ { ssrc: 1 }, { ssrc: 2 } ]);
	});

	test('leaves screen audio encodings untouched', async () => {
		const { sut, context, produceDeduped } = produceContext('screenaudio', 'audio');

		await sut(context, next);

		expect(produceDeduped.mock.calls[0][0].rtpParameters.encodings)
			.toEqual([ { ssrc: 1 }, { ssrc: 2 } ]);
	});
});

describe('produceData', () => {
	test('creates a data producer for transcripts in a plain room', async () => {
		const { sut, context, produceData } = produceDataContext('transcription', false);

		await sut(context, next);

		expect(produceData).toHaveBeenCalledTimes(1);
		expect(context.handled).toBe(true);
		expect(context.response.id).toBe('dp1');
	});

	test('creates a data producer for transcripts in an end-to-end encrypted room', async () => {
		const { sut, context, produceData } = produceDataContext('transcription', true);

		await sut(context, next);

		expect(produceData).toHaveBeenCalledTimes(1);
		expect(context.handled).toBe(true);
	});

	test('accepts monitoring samples in a plain room', async () => {
		const { sut, context, produceData } = produceDataContext(OBSERVER_SAMPLES_LABEL, false);

		await sut(context, next);

		expect(produceData).toHaveBeenCalledTimes(1);
		expect(context.handled).toBe(true);
	});

	test('accepts monitoring samples in an end-to-end encrypted room too, without handing them to other peers', async () => {
		const { sut, context, produceData, room } = produceDataContext(OBSERVER_SAMPLES_LABEL, true);

		await sut(context, next);

		expect(produceData).toHaveBeenCalledTimes(1);
		expect(context.handled).toBe(true);
		expect(room.getPeers).not.toHaveBeenCalled();
	});

	test('refuses a data producer from a headless peer', async () => {
		for (const label of [ 'transcription', 'chat', 'files', '' ]) {
			const { sut, context, produceData } = produceDataContext(label, false, true);

			await expect(sut(context, next)).rejects.toThrow('headless');

			expect(produceData).not.toHaveBeenCalled();
			expect(context.handled).toBe(false);
		}
	});

	test('lets a headless peer send monitoring samples, which reach no other peer', async () => {
		const { sut, context, produceData, room } = produceDataContext('observertc-samples', false, true);

		await sut(context, next);

		expect(produceData).toHaveBeenCalledTimes(1);
		expect(context.handled).toBe(true);
		expect(room.getPeers).not.toHaveBeenCalled();
	});
});

describe('the peer-to-peer messages', () => {
	const relayContext = (method: string, { sender = {}, receiver = {}, data = {} }: { sender?: Record<string, unknown>; receiver?: Record<string, unknown>; data?: Record<string, unknown> } = {}) => {
		const remote = { id: 'p2', sessionId: 's1', headless: false, notify: jest.fn(), ...receiver };
		const peers = new Map([ [ 'p2', remote ] ]);
		const room = { sessionId: 's1', peers: { get: (id: string) => peers.get(id) } } as unknown as Room;
		const peer = { id: 'p1', sessionId: 's1', headless: false, hasPermission: jest.fn(() => true), sameSession: (other: { sessionId: string }) => other.sessionId === 's1', ...sender };
		const message = { method, data: { sessionId: 's1', peerId: 'p2', ...data } };
		const context = { peer, message, response: {}, handled: false } as unknown as PeerContext;

		return { sut: createMediaMiddleware({ room }), context, remote, peer };
	};
	const methods = [ 'peerLoad', 'peerConnect', 'candidate', 'peerCloseProducer', 'peerPauseProducer', 'peerResumeProducer', 'pausePeerConsumer', 'resumePeerConsumer' ];

	test.each(methods)('pass %s between two participants of the session', async (method) => {
		const { sut, context, remote } = relayContext(method);

		await sut(context, next);

		expect(remote.notify).toHaveBeenCalledWith(expect.objectContaining({ method }));
		expect(context.handled).toBe(true);
	});

	test.each([ ...methods, 'peerProduce' ])('pass no %s from a bot or to another session', async (method) => {
		const data = { id: 'x', kind: 'audio', rtpParameters: {}, appData: { source: 'mic' } };

		for (const [ setup, error ] of [ [ { sender: { headless: true } }, 'peer not authorized' ], [ { receiver: { sessionId: 'breakout' } }, 'not found' ] ] as const) {
			const { sut, context, remote } = relayContext(method, { ...setup, data });

			await expect(sut(context, next)).rejects.toThrow(error);
			expect(remote.notify).not.toHaveBeenCalled();
		}
	});

	test.each([ ...methods, 'peerProduce' ])('drop %s to a bot without an error', async (method) => {
		const { sut, context, remote } = relayContext(method, { receiver: { headless: true }, data: { id: 'x', kind: 'audio', rtpParameters: {}, appData: { source: 'mic' } } });

		await sut(context, next);

		expect(remote.notify).not.toHaveBeenCalled();
		expect(context.handled).toBe(true);
	});

	test('offer media only from a participant allowed to share it', async () => {
		const appData = { source: 'webcam' };
		const allowed = relayContext('peerProduce', { data: { id: 'x', kind: 'video', rtpParameters: {}, appData }, receiver: { hasPermission: jest.fn(() => false) } });

		await allowed.sut(allowed.context, next);
		expect(allowed.remote.notify).toHaveBeenCalledWith(expect.objectContaining({ method: 'peerProduce' }));

		const refused = relayContext('peerProduce', { data: { id: 'x', kind: 'video', rtpParameters: {}, appData }, sender: { hasPermission: jest.fn(() => false) } });

		await expect(refused.sut(refused.context, next)).rejects.toThrow('peer not authorized');
		expect(refused.remote.notify).not.toHaveBeenCalled();
	});

	test('offer no media from a bot', async () => {
		const { sut, context, remote } = relayContext('peerProduce', { data: { id: 'x', kind: 'audio', rtpParameters: {}, appData: { source: 'mic' } }, sender: { headless: true }, receiver: { hasPermission: jest.fn(() => true) } });

		await expect(sut(context, next)).rejects.toThrow('peer not authorized');
		expect(remote.notify).not.toHaveBeenCalled();
	});
});
