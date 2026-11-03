import 'jest';
import { createMediaMiddleware } from '../../../src/middlewares/mediaMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import { createConsumer, createDataConsumer } from '../../../src/common/consuming';

jest.mock('../../../src/common/consuming', () => ({
	...jest.requireActual('../../../src/common/consuming'),
	createConsumer: jest.fn(),
	createDataConsumer: jest.fn(),
}));

const mockCreateConsumer = createConsumer as jest.Mock;
const mockCreateDataConsumer = createDataConsumer as jest.Mock;

const next = jest.fn();

const otherPeer = (id: string) => ({ id, sameSession: () => true });

const roomWith = (peers: unknown[]) => ({
	sessionId: 's1',
	endToEndEncryption: false,
	getPeers: jest.fn(() => peers),
}) as unknown as Room;

const producingPeer = () => ({
	id: 'p1',
	headless: false,
	hasPermission: jest.fn(() => true),
	producers: new Map(),
	dataProducers: new Map(),
	notify: jest.fn(),
	producingTransport: {
		produceDeduped: jest.fn(async () => ({
			producer: { id: 'prod1', appData: {}, once: jest.fn(), on: jest.fn() },
			reused: false,
		})),
		produceData: jest.fn(async (options: { label: string }) => ({
			id: 'dp1', label: options.label, appData: {}, once: jest.fn(),
		})),
	},
});

const neverSettles = () => new Promise<void>(() => undefined);

afterEach(() => {
	jest.clearAllMocks();
});

test('a new producer reaches every peer even when an earlier peer never gets its router', async () => {
	const stuck = otherPeer('stuck');
	const waiting = otherPeer('waiting');
	const sut = createMediaMiddleware({ room: roomWith([ stuck, waiting ]) });
	const context = {
		peer: producingPeer(),
		message: {
			method: 'produce',
			data: { sessionId: 's1', kind: 'audio', rtpParameters: { encodings: [] }, appData: { source: 'mic' } },
		},
		response: {},
		handled: false,
	} as unknown as PeerContext;

	mockCreateConsumer.mockImplementation((consumerPeer) => (consumerPeer === stuck ? neverSettles() : Promise.resolve()));

	await sut(context, next);

	expect(mockCreateConsumer.mock.calls.map(([ consumerPeer ]) => consumerPeer)).toEqual([ stuck, waiting ]);
});

test('a new data producer reaches every peer even when an earlier peer never gets its router', async () => {
	const stuck = otherPeer('stuck');
	const waiting = otherPeer('waiting');
	const sut = createMediaMiddleware({ room: roomWith([ stuck, waiting ]) });
	const context = {
		peer: producingPeer(),
		message: {
			method: 'produceData',
			data: { sessionId: 's1', sctpStreamParameters: {}, label: 'transcription', protocol: '', appData: {} },
		},
		response: {},
		handled: false,
	} as unknown as PeerContext;

	mockCreateDataConsumer.mockImplementation((consumerPeer) => (consumerPeer === stuck ? neverSettles() : Promise.resolve()));

	await sut(context, next);

	expect(mockCreateDataConsumer.mock.calls.map(([ consumerPeer ]) => consumerPeer)).toEqual([ stuck, waiting ]);
});
