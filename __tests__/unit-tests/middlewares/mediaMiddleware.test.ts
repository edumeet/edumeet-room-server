import { createMediaMiddleware } from '../../../src/middlewares/mediaMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import { OBSERVER_SAMPLES_LABEL } from '../../../src/common/consuming';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

const produceDataContext = (label: string, endToEndEncryption: boolean) => {
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
		producingTransport: { produceData },
		dataProducers: new Map(),
	};
	const message = {
		method: 'produceData',
		data: { sessionId: 's1', sctpStreamParameters: {}, label, protocol: '', appData: {} },
	};
	const context = { peer, message, response: {}, handled: false } as unknown as PeerContext;

	return { sut: createMediaMiddleware({ room }), context, produceData };
};

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

	test('refuses monitoring samples in an end-to-end encrypted room before the media node is asked', async () => {
		const { sut, context, produceData } = produceDataContext(OBSERVER_SAMPLES_LABEL, true);

		await expect(sut(context, next)).rejects.toThrow('end-to-end encrypted');

		expect(produceData).not.toHaveBeenCalled();
		expect(context.handled).toBe(false);
	});
});
