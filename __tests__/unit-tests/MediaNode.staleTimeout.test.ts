import { KDPoint, SocketTimeoutError } from 'edumeet-common';
import { EventEmitter } from 'events';
import 'jest';
import { MediaNode } from '../../src/media/MediaNode';

/* eslint-disable no-unused-vars */
interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface FakeConnection extends EventEmitter {
	closed: boolean;
	requests: PendingRequest[];
	settle: () => void;
	fail: () => void;
}
/* eslint-enable no-unused-vars */

const mockState: { settleOnCreate: boolean; connections: FakeConnection[] } = { settleOnCreate: true, connections: [] };

jest.mock('../../src/media/MediaNodeConnection', () => {
	const actual = jest.requireActual('../../src/media/MediaNodeConnection');
	const { EventEmitter: Emitter } = jest.requireActual('events');

	class MockMediaNodeConnection extends Emitter {
		closed = false;
		pipeline = { use: jest.fn(), remove: jest.fn() };
		notify = jest.fn();
		requests: PendingRequest[] = [];
		ready: Promise<[ Error | null, null ]>;
		// eslint-disable-next-line no-unused-vars
		#resolve!: (value: [ Error | null, null ]) => void;

		constructor() {
			super();
			this.ready = new Promise((resolve) => (this.#resolve = resolve));
			mockState.connections.push(this as unknown as FakeConnection);

			if (mockState.settleOnCreate) this.settle();
		}

		settle() {
			this.#resolve([ null, null ]);
		}

		fail() {
			this.#resolve([ new actual.ConnectionError('connection closed before ready'), null ]);
		}

		request() {
			return new Promise((resolve, reject) => this.requests.push({ resolve, reject }));
		}

		close(remoteClose = false) {
			if (this.closed) return;
			this.closed = true;
			this.emit('close', remoteClose);
		}
	}

	return { ...actual, MediaNodeConnection: MockMediaNodeConnection };
});

let node: MediaNode | undefined;

beforeEach(() => {
	jest.useFakeTimers();
	mockState.settleOnCreate = true;
	mockState.connections = [];
});

afterEach(() => {
	node?.close();
	node = undefined;
	jest.useRealTimers();
});

const createNode = () => new MediaNode({
	id: 'id',
	hostname: 'node1.example.org',
	port: 3443,
	secret: 's',
	turnports: [],
	kdPoint: new KDPoint([ 50, 10 ])
});

test('a late timeout from a closed connection leaves the newer connection open', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(0);

	const first = node.request({ method: 'one' }).catch((error) => error);
	const second = node.request({ method: 'two' }).catch((error) => error);

	await jest.advanceTimersByTimeAsync(0);

	const oldConnection = mockState.connections[mockState.connections.length - 1];

	expect(oldConnection.requests).toHaveLength(2);

	oldConnection.requests[0].reject(new SocketTimeoutError('Request timed out'));
	await first;
	expect(oldConnection.closed).toBe(true);

	mockState.settleOnCreate = false;

	const third = node.request({ method: 'three' });

	await jest.advanceTimersByTimeAsync(0);

	const newConnection = mockState.connections[mockState.connections.length - 1];

	expect(newConnection).not.toBe(oldConnection);

	oldConnection.requests[1].reject(new SocketTimeoutError('Request timed out'));
	await second;

	expect(newConnection.closed).toBe(false);

	newConnection.settle();
	await jest.advanceTimersByTimeAsync(0);
	newConnection.requests[0].resolve({ ok: true });

	await expect(third).resolves.toEqual({ ok: true });
});

test('a failed connection attempt that wakes up late leaves the newer connection open', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(0);

	mockState.settleOnCreate = false;

	const first = node.request({ method: 'one' }).catch((error) => error);

	await jest.advanceTimersByTimeAsync(0);

	const oldConnection = mockState.connections[mockState.connections.length - 1];

	oldConnection.closed = true;

	const second = node.request({ method: 'two' });

	await jest.advanceTimersByTimeAsync(0);

	const newConnection = mockState.connections[mockState.connections.length - 1];

	expect(newConnection).not.toBe(oldConnection);

	oldConnection.fail();
	await first;

	expect(newConnection.closed).toBe(false);

	newConnection.settle();
	await jest.advanceTimersByTimeAsync(0);
	newConnection.requests[0].resolve({ ok: true });

	await expect(second).resolves.toEqual({ ok: true });
});
