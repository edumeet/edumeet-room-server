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
