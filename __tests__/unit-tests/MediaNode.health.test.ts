import { KDPoint, Logger } from 'edumeet-common';
import { EventEmitter } from 'events';
import 'jest';
import { MediaNode } from '../../src/media/MediaNode';
import { TimeoutError } from '../../src/media/MediaNodeConnection';

type Outcome = 'ok' | 'fail' | 'draining' | 'pending';

/* eslint-disable no-unused-vars */
interface FakeConnection extends EventEmitter {
	closed: boolean;
	createdAt: number;
	notify: jest.Mock;
	request: jest.Mock;
	close: (remoteClose?: boolean) => void;
	settle: (outcome: Exclude<Outcome, 'pending'>) => void;
}
/* eslint-enable no-unused-vars */

const mockState: { outcome: Outcome; connections: FakeConnection[] } = { outcome: 'ok', connections: [] };

jest.mock('../../src/media/MediaNodeConnection', () => {
	const actual = jest.requireActual('../../src/media/MediaNodeConnection');
	const { EventEmitter: Emitter } = jest.requireActual('events');

	class MockMediaNodeConnection extends Emitter {
		closed = false;
		createdAt = Date.now();
		pipeline = { use: jest.fn(), remove: jest.fn() };
		notify = jest.fn();
		request = jest.fn();
		ready: Promise<[ Error | null, null ]>;
		// eslint-disable-next-line no-unused-vars
		#resolve!: (value: [ Error | null, null ]) => void;

		constructor() {
			super();
			this.ready = new Promise((resolve) => (this.#resolve = resolve));
			mockState.connections.push(this as unknown as FakeConnection);

			if (mockState.outcome !== 'pending') this.settle(mockState.outcome);
		}

		settle(outcome: 'ok' | 'fail' | 'draining') {
			if (outcome === 'ok') return this.#resolve([ null, null ]);
			if (outcome === 'draining') return this.#resolve([ new actual.DrainingError('Media node is draining'), null ]);

			this.#resolve([ new actual.TimeoutError('connection timed out'), null ]);
		}

		close(remoteClose = false) {
			if (this.closed) return;
			this.closed = true;
			this.emit('close', remoteClose);
		}
	}

	return { ...actual, MediaNodeConnection: MockMediaNodeConnection };
});

const createNode = (): MediaNode => new MediaNode({
	id: 'id',
	hostname: 'node1.example.org',
	port: 3443,
	secret: 's',
	turnports: [],
	kdPoint: new KDPoint([ 50, 10 ])
});

const flapCountOf = (node: MediaNode): number => (node as unknown as { flapCount: number }).flapCount;

const probesSince = (since: number): number[] =>
	mockState.connections.filter((c) => c.createdAt > since).map((c) => c.createdAt);

const loseLiveConnection = async (node: MediaNode): Promise<void> => {
	mockState.outcome = 'ok';
	await node.notify({ method: 'keepAlive' });
	mockState.connections[mockState.connections.length - 1].close(true);
};

let node: MediaNode | undefined;

beforeEach(() => {
	jest.useFakeTimers();
	jest.spyOn(Math, 'random').mockReturnValue(0);
	mockState.outcome = 'ok';
	mockState.connections = [];
});

afterEach(() => {
	node?.close();
	node = undefined;
	jest.useRealTimers();
	jest.restoreAllMocks();
});

test('concurrent callers failing on one connection attempt count as one flap', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(0);
	expect(node.healthy).toBe(true);

	mockState.outcome = 'pending';

	const attempts = Array.from({ length: 10 }, () => node!.getRouter({ roomId: 'room' }).catch((error) => error));

	await jest.advanceTimersByTimeAsync(0);
	mockState.connections[mockState.connections.length - 1].settle('fail');

	const errors = await Promise.all(attempts);

	expect(errors.every((e) => e instanceof TimeoutError)).toBe(true);
	expect(node.healthy).toBe(false);
	expect(flapCountOf(node)).toBe(1);

	mockState.outcome = 'fail';

	const failedAt = Date.now();

	await jest.advanceTimersByTimeAsync(9_999);
	expect(probesSince(failedAt)).toHaveLength(0);

	await jest.advanceTimersByTimeAsync(1);
	expect(probesSince(failedAt)).toHaveLength(1);
	expect(flapCountOf(node)).toBe(1);
});

test('a node that stays down is retried every 10s, then every 60s after 2 min, then every 5 min after 10 min', async () => {
	mockState.outcome = 'fail';

	node = createNode();

	const downAt = Date.now();

	await jest.advanceTimersByTimeAsync(30 * 60_000);

	const probes = mockState.connections.map((c) => c.createdAt - downAt);
	const gaps = probes.slice(1).map((t, i) => [ probes[i], t - probes[i] ]);

	expect(node.healthy).toBe(false);
	expect(flapCountOf(node)).toBe(1);

	for (const [ previousProbe, gap ] of gaps) {
		const expected = previousProbe < 2 * 60_000 ? 10_000 : previousProbe < 10 * 60_000 ? 60_000 : 5 * 60_000;

		expect(gap).toBe(expected);
	}

	expect(gaps.some(([ , gap ]) => gap === 5 * 60_000)).toBe(true);
});

test('recovery marks the node healthy and stops probing', async () => {
	mockState.outcome = 'fail';
	node = createNode();
	await jest.advanceTimersByTimeAsync(0);
	expect(node.healthy).toBe(false);

	mockState.outcome = 'ok';
	await jest.advanceTimersByTimeAsync(10_000);
	expect(node.healthy).toBe(true);

	const recoveredAt = Date.now();

	await jest.advanceTimersByTimeAsync(60_000);
	expect(probesSince(recoveredAt)).toHaveLength(0);
});

test('a node that goes down again soon after recovering still backs off', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(1_000);

	await loseLiveConnection(node);
	expect(flapCountOf(node)).toBe(1);

	await jest.advanceTimersByTimeAsync(10_000);
	expect(node.healthy).toBe(true);

	await jest.advanceTimersByTimeAsync(30_000);
	await loseLiveConnection(node);
	expect(flapCountOf(node)).toBe(2);

	const lostAt = Date.now();

	await jest.advanceTimersByTimeAsync(59_999);
	expect(probesSince(lostAt)).toHaveLength(0);

	await jest.advanceTimersByTimeAsync(1);
	expect(probesSince(lostAt)).toHaveLength(1);
});

test('routine health checks do not postpone the flap counter reset', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(1_000);

	await loseLiveConnection(node);
	await jest.advanceTimersByTimeAsync(10_000);
	expect(node.healthy).toBe(true);

	// Routine checks run every 5 min while no connection is open; one lands just before the reset.
	await jest.advanceTimersByTimeAsync((5 * 60_000) + 1_000);
	expect(flapCountOf(node)).toBe(0);

	await loseLiveConnection(node);
	expect(flapCountOf(node)).toBe(1);

	const lostAt = Date.now();

	await jest.advanceTimersByTimeAsync(10_000);
	expect(probesSince(lostAt)).toHaveLength(1);
});

test('a request timeout on a live connection is one flap and closes the connection', async () => {
	const { SocketTimeoutError } = jest.requireActual('edumeet-common');

	node = createNode();
	await jest.advanceTimersByTimeAsync(1_000);

	mockState.outcome = 'ok';
	await node.notify({ method: 'keepAlive' });

	const live = mockState.connections[mockState.connections.length - 1];

	live.request.mockRejectedValue(new SocketTimeoutError('Request timed out'));

	const results = await Promise.allSettled([
		node.request({ method: 'getRouter' }),
		node.request({ method: 'getRouter' })
	]);

	expect(results.map((r) => r.status)).toEqual([ 'rejected', 'rejected' ]);
	expect(live.closed).toBe(true);
	expect(node.healthy).toBe(false);
	expect(flapCountOf(node)).toBe(1);
});

test('a draining node is marked draining and unhealthy, and recovers when it stops draining', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(1_000);

	mockState.outcome = 'draining';
	await node.healthCheck();

	expect(node.draining).toBe(true);
	expect(node.healthy).toBe(false);
	expect(flapCountOf(node)).toBe(1);

	mockState.outcome = 'ok';
	await node.healthCheck();

	expect(node.draining).toBe(false);
	expect(node.healthy).toBe(true);
});

test('a healthy node stays quiet: routine checks change nothing', async () => {
	node = createNode();
	await jest.advanceTimersByTimeAsync(1_000);

	const loggerPrototype = Logger.prototype as unknown as Record<string, unknown>;
	const warn = jest.spyOn(loggerPrototype, 'warn', 'get');
	const info = jest.spyOn(loggerPrototype, 'info', 'get');

	await node.healthCheck();
	await node.healthCheck();

	expect(node.healthy).toBe(true);
	expect(flapCountOf(node)).toBe(0);
	expect(warn).not.toHaveBeenCalled();
	expect(info).not.toHaveBeenCalled();
});
