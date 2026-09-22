import 'jest';
import { createConsumer } from '../../../src/common/consuming';

const mockWarn = jest.fn();
const mockDebug = jest.fn();

// edumeet-common's Logger exposes its levels as getters over a pino instance,
// which jest cannot spy on through the typings; the module gets a plain stand-in.
jest.mock('edumeet-common', () => ({
	...jest.requireActual('edumeet-common'),
	// getters: the module under test builds its logger at import time, before these mocks exist
	Logger: class {
		get warn() { return mockWarn; }
		get debug() { return mockDebug; }
		get info() { return jest.fn(); }
		get error() { return jest.fn(); }
	}
}));
import type { Peer } from '../../../src/Peer';
import type { Producer } from '../../../src/media/Producer';

const peerWith = (codecs: { kind: string }[]): Peer => ({
	id: 'consumer',
	rtpCapabilities: { codecs, headerExtensions: [] },
	routerReady: Promise.resolve([ undefined, { canConsume: () => false } ]),
	consumingTransport: undefined,
}) as unknown as Peer;

const producerPeer = { id: 'producer', routerReady: Promise.resolve([ undefined, { canConsume: () => false } ]) } as unknown as Peer;

describe('a peer that cannot consume a producer', () => {
	test('is only noted when it declared no codec of that kind, and warned about otherwise', async () => {
		await createConsumer(peerWith([ { kind: 'audio' } ]), producerPeer, { id: 'v1', kind: 'video' } as unknown as Producer);

		expect(mockWarn).not.toHaveBeenCalled();
		expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('cannot consume'), 'producer', 'v1', true);

		await createConsumer(peerWith([ { kind: 'audio' }, { kind: 'video' } ]), producerPeer, { id: 'v2', kind: 'video' } as unknown as Producer);

		expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('cannot consume'), 'producer', 'v2', false);
	});
});
