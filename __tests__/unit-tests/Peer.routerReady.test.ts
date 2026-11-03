import 'jest';
import { Socket } from 'socket.io';
import { Peer } from '../../src/Peer';
import { IOServerConnection } from '../../src/common/IOServerConnection';

const mockSocket = () => ({
	id: 'testSocket',
	join: jest.fn(),
	leave: jest.fn(),
	to: jest.fn(),
	emit: jest.fn(),
	on: jest.fn(),
	once: jest.fn(),
	removeAllListeners: jest.fn(),
	disconnect: jest.fn(),
	handshake: { address: '127.0.0.1', headers: {} },
}) as unknown as Socket;

const NOT_SETTLED = 'not settled';

const settledWithin = <T>(promise: Promise<T>, ms = 200): Promise<T | typeof NOT_SETTLED> =>
	Promise.race([ promise, new Promise<typeof NOT_SETTLED>((resolve) => setTimeout(() => resolve(NOT_SETTLED), ms)) ]);

const createPeer = () => new Peer({
	id: 'peer',
	sessionId: 'session',
	displayName: 'name',
	reconnectKey: 'key',
	connection: new IOServerConnection(mockSocket()),
});

test('closing a peer settles a pending router wait', async () => {
	const peer = createPeer();
	const waiting = peer.routerReady;

	peer.close();

	const result = await settledWithin(waiting);

	expect(result).not.toBe(NOT_SETTLED);
	expect((result as [ Error | null, unknown ])[0]).toBeInstanceOf(Error);
});

test('a reconnect settles the router wait of the previous connection', async () => {
	const peer = createPeer();
	const waiting = peer.routerReady;

	peer.switchConnection(new IOServerConnection(mockSocket()));

	const result = await settledWithin(waiting);

	expect(result).not.toBe(NOT_SETTLED);
	expect((result as [ Error | null, unknown ])[0]).toBeInstanceOf(Error);
	expect(peer.routerReady).not.toBe(waiting);

	peer.close();
});

test('a router that was already assigned is not taken back by close', async () => {
	const peer = createPeer();
	const router = { id: 'router' };

	peer.resolveRouterReady(router as never);
	peer.close();

	const [ error, ready ] = await peer.routerReady;

	expect(error).toBeNull();
	expect(ready).toBe(router);
});
