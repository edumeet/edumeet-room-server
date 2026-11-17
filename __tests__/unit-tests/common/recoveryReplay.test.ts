import 'jest';
import http from 'http';
import { AddressInfo } from 'net';
import { Server, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { socketServerOptions } from '../../../src/common/socketServerOptions';
import { IOServerConnection } from '../../../src/common/IOServerConnection';
import { socketHandler } from '../../../src/common/socketHandler';
import { ownSession, RecoveryAdapter } from '../../../src/common/recoveryAdapter';
import { MAX_RECONNECTS_PER_MINUTE } from '../../../src/common/rateLimiter';
import * as suspiciousClients from '../../../src/common/suspiciousClients';

type Kept = { sessions: Map<string, unknown>; packets: Array<{ emittedAt: number }> };

// What socket.io hands a client that recovers its session after a drop.
describe('a recovered session', () => {
	const maxUnsentBytes = IOServerConnection.maxUnsentBytes;
	const stallBytes = IOServerConnection.stallBytes;
	const stallMs = IOServerConnection.stallMs;
	const addressBurstBytes = RecoveryAdapter.addressBurstBytes;
	const addressBytesPerSecond = RecoveryAdapter.addressBytesPerSecond;
	const serverManagerBefore = global.serverManager;
	const ROOM_QUERY = { roomId: 'room', peerId: 'peer', reconnectKey: 'key' };
	// The room server takes every connection for this peer, from this address.
	const taken = (socket: Socket) => ownSession(socket, 'peer', address);
	let address: string;
	let httpServer: http.Server;
	let server: Server;
	let url: string;
	let sockets: Socket[];
	let clients: ClientSocket[];
	let connections: IOServerConnection[];
	// eslint-disable-next-line no-unused-vars
	let onConnection: (socket: Socket) => void;

	beforeEach(async () => {
		sockets = [];
		clients = [];
		connections = [];
		address = '203.0.113.7';
		onConnection = taken;
		httpServer = http.createServer();
		server = new Server(httpServer, socketServerOptions);
		server.on('connection', (socket: Socket) => {
			sockets.push(socket);
			onConnection(socket);
		});
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		IOServerConnection.maxUnsentBytes = maxUnsentBytes;
		IOServerConnection.stallBytes = stallBytes;
		IOServerConnection.stallMs = stallMs;
		RecoveryAdapter.addressBurstBytes = addressBurstBytes;
		RecoveryAdapter.addressBytesPerSecond = addressBytesPerSecond;
		global.serverManager = serverManagerBefore;
		jest.restoreAllMocks();
		clients.forEach((client) => client.close());
		server.close();
		await new Promise((resolve) => httpServer.close(resolve));
	});

	const kept = () => server.of('/').adapter as unknown as Kept;
	const until = (check: () => boolean) => new Promise<void>((resolve) => {
		const poll = () => (check() ? resolve() : setTimeout(poll, 5));

		poll();
	});
	const client = (options: Record<string, unknown> = {}) => {
		const created = ioClient(url, { reconnection: false, transports: [ 'websocket' ], ...options });

		clients.push(created);

		return created;
	};

	// A connection that gets notifications and then drops, leaving its session behind.
	const dropped = async (notifications: string[], options: Record<string, unknown> = {}) => {
		const count = sockets.length;
		const first = client(options);
		const offsets: string[] = [];

		first.on('notification', (_n: unknown, offset: string) => offsets.push(offset));
		await until(() => sockets.length === count + 1 && first.connected);

		const pid = (first as unknown as { _pid: string })._pid;
		const socket = sockets[count];

		notifications.forEach((data) => socket.emit('notification', { method: 'note', data }));
		await until(() => offsets.length === notifications.length);

		await drop({ socket, client: first });

		return { pid, offsets };
	};

	// The client's transport fails; the server keeps the session of its socket.
	const drop = async ({ socket, client: dropping }: { socket: Socket; client: ClientSocket }) => {
		const gone = socket.connected ? new Promise((resolve) => socket.once('disconnect', resolve)) : undefined;

		(dropping.io.engine as unknown as { close: () => void }).close();
		await gone;
	};

	const recover = async (pid: string, offset: string, options: Record<string, unknown> = {}) => {
		const count = sockets.length;
		const received: string[] = [];
		const ended = { reason: '' };
		const again = client({ auth: { pid, offset }, ...options });

		again.on('notification', (n: { data: string }) => received.push(n.data));
		// Listened for from the start: a socket the room server refuses can be cut before this returns.
		again.on('disconnect', (why: string) => {
			ended.reason = why;
		});
		await until(() => sockets.length === count + 1);

		return { socket: sockets[count], received, client: again, ended };
	};

	// The normal case: the network drops, the client reconnects by itself and gets what it missed.
	test('is recovered by a client that reconnects on its own, with what was sent while it was away', async () => {
		const reconnecting = client({ reconnection: true, reconnectionDelay: 50, reconnectionDelayMax: 50 });
		const received: string[] = [];

		reconnecting.on('notification', (n: { data: string }) => received.push(n.data));
		await until(() => sockets.length === 1 && reconnecting.connected);

		const id = sockets[0].id;

		sockets[0].emit('notification', { method: 'note', data: 'before' });
		await until(() => received.length === 1);

		const gone = new Promise((resolve) => sockets[0].once('disconnect', resolve));

		(sockets[0].conn as unknown as { transport: { socket: { terminate: () => void } } }).transport.socket.terminate();
		await gone;
		server.to(id).emit('notification', { method: 'note', data: 'while away 1' });
		server.to(id).emit('notification', { method: 'note', data: 'while away 2' });

		await until(() => sockets.length === 2 && reconnecting.connected && received.length === 3);
		expect(sockets[1].recovered).toBe(true);
		expect(reconnecting.recovered).toBe(true);
		expect(received).toEqual([ 'before', 'while away 1', 'while away 2' ]);
	}, 10_000);

	test('is restored once: a second client with the same session connects afresh', async () => {
		const { pid, offsets } = await dropped([ 'a', 'b', 'c' ]);
		const first = await recover(pid, offsets[0]);

		await until(() => first.received.length === 2);
		expect(first.socket.recovered).toBe(true);
		expect(first.received).toEqual([ 'b', 'c' ]);

		const second = await recover(pid, offsets[0]);

		expect(second.socket.recovered).toBe(false);
	});

	// A recovered socket keeps the id of its session and leaves the session behind again.
	test('that drops again is handed nothing a second time, whatever offset its client names', async () => {
		const { pid, offsets } = await dropped([ 'a', 'b', 'c' ]);
		const first = await recover(pid, offsets[0]);

		await until(() => first.received.length === 2);
		expect(first.received).toEqual([ 'b', 'c' ]);
		await drop(first);

		const second = await recover(pid, offsets[0]);

		expect(second.socket.recovered).toBe(true);
		second.socket.emit('notification', { method: 'note', data: 'd' });
		await until(() => second.received.length > 0);
		expect(second.received).toEqual([ 'd' ]);
		await drop(second);
		server.to(second.socket.id).emit('notification', { method: 'note', data: 'e' });

		// What was sent since the last restore is handed back, once.
		const third = await recover(pid, offsets[0]);

		await until(() => third.received.length === 2);
		expect(third.received).toEqual([ 'd', 'e' ]);
		await drop(third);

		const fourth = await recover(pid, offsets[0]);

		expect(fourth.socket.recovered).toBe(true);
		fourth.socket.emit('notification', { method: 'note', data: 'f' });
		await until(() => fourth.received.length > 0);
		expect(fourth.received).toEqual([ 'f' ]);
	});

	test('is restored as often in a minute as a peer may reconnect, and then counts against its address', async () => {
		const reported = jest.spyOn(suspiciousClients, 'limitHit').mockImplementation(() => undefined);
		const { pid, offsets } = await dropped([ 'a', 'b' ]);

		for (let i = 0; i < MAX_RECONNECTS_PER_MINUTE; i++) {
			const again = await recover(pid, offsets[0]);

			expect(again.socket.recovered).toBe(true);
			await drop(again);
		}

		expect(reported).not.toHaveBeenCalled();

		const refused = await recover(pid, offsets[0]);

		expect(refused.socket.recovered).toBe(false);
		expect(refused.received).toEqual([]);
		expect(reported).toHaveBeenCalledWith(address);
		expect(kept().sessions.has(pid)).toBe(false);
	}, 20_000);

	test('shares a budget of bytes with the other sessions of its address', async () => {
		RecoveryAdapter.addressBurstBytes = 3_000;
		RecoveryAdapter.addressBytesPerSecond = 1;

		const reported = jest.spyOn(suspiciousClients, 'limitHit').mockImplementation(() => undefined);
		const one = await dropped([ 'a', 'x'.repeat(2_000) ]);
		const two = await dropped([ 'a', 'y'.repeat(2_000) ]);

		address = '198.51.100.9';

		const elsewhere = await dropped([ 'a', 'z'.repeat(2_000) ]);
		const first = await recover(one.pid, one.offsets[0]);

		await until(() => first.received.length === 1);
		expect(first.socket.recovered).toBe(true);

		const second = await recover(two.pid, two.offsets[0]);

		expect(second.socket.recovered).toBe(false);
		expect(second.received).toEqual([]);

		const third = await recover(elsewhere.pid, elsewhere.offsets[0]);

		await until(() => third.received.length === 1);
		expect(third.socket.recovered).toBe(true);
		// Everyone behind the address shares the budget: running out of it is no one's misuse.
		expect(reported).not.toHaveBeenCalled();
	});

	test('of a connection the room server never took is not restored', async () => {
		onConnection = () => undefined;

		const { pid, offsets } = await dropped([ 'a', 'b' ]);
		const recovered = await recover(pid, offsets[0]);

		expect(recovered.socket.recovered).toBe(false);
		expect(recovered.received).toEqual([]);
	});

	test('is not restored when what it would hand back is more than a connection may have waiting', async () => {
		IOServerConnection.maxUnsentBytes = 2_000;

		const { pid, offsets } = await dropped([ 'a', 'x'.repeat(1_500), 'y'.repeat(1_500) ]);
		const recovered = await recover(pid, offsets[0]);

		expect(recovered.socket.recovered).toBe(false);
		expect(recovered.received).toEqual([]);
	});

	test('hands back only what was sent from a minute before the drop on, whatever offset the client names', async () => {
		const { pid, offsets } = await dropped([ 'a', 'old', 'older', 'new' ]);

		kept().packets.slice(0, 3).forEach((packet) => {
			packet.emittedAt -= 120_000;
		});

		const recovered = await recover(pid, offsets[0]);

		await until(() => recovered.received.length === 1);
		expect(recovered.socket.recovered).toBe(true);
		expect(recovered.received).toEqual([ 'new' ]);
	});

	test('refused by the room server, is cut, and its session cannot be asked for again', async () => {
		const { pid, offsets } = await dropped([ 'a', 'b' ]);

		onConnection = socketHandler;

		const refused = await recover(pid, offsets[0], { query: {} });

		await until(() => refused.ended.reason !== '');

		expect(refused.socket.recovered).toBe(true);
		expect(refused.ended.reason).toMatch(/^transport (close|error)$/);
		await until(() => !kept().sessions.has(pid));
		expect(kept().sessions.has(pid)).toBe(false);
	});

	describe('handed to the room server', () => {
		let handleConnection: jest.Mock;

		beforeEach(() => {
			handleConnection = jest.fn(async () => undefined);
			global.serverManager = { handleConnection } as unknown as typeof global.serverManager;
			onConnection = socketHandler;
		});

		test('as the peer it belongs to, is kept and counts as a connection that was handed data', async () => {
			const sent = jest.spyOn(suspiciousClients, 'replaySent');
			const { pid, offsets } = await dropped([ 'a', 'b' ], { query: ROOM_QUERY });

			expect(sent).not.toHaveBeenCalled();

			const resumed = await recover(pid, offsets[0], { query: ROOM_QUERY });

			await until(() => resumed.received.length === 1);
			expect(resumed.socket.recovered).toBe(true);
			expect(resumed.ended.reason).toBe('');
			expect(handleConnection).toHaveBeenCalledTimes(2);
			expect(handleConnection.mock.calls[1][0].recovered).toBe(true);
			expect(handleConnection.mock.calls[1][1]).toBe('peer');
			expect(sent).toHaveBeenCalledWith(handleConnection.mock.calls[1][0]);
		});

		// A peerId no one uses has no limit on reconnects, and another's is not this client's.
		test('under another peerId, is cut and forgotten, and counts against its address', async () => {
			const reported = jest.spyOn(suspiciousClients, 'limitHit').mockImplementation(() => undefined);
			const { pid, offsets } = await dropped([ 'a', 'b' ], { query: ROOM_QUERY });
			const refused = await recover(pid, offsets[0], { query: { ...ROOM_QUERY, peerId: 'other' } });

			await until(() => refused.ended.reason !== '');

			expect(refused.socket.recovered).toBe(true);
			expect(refused.ended.reason).toMatch(/^transport (close|error)$/);
			expect(handleConnection).toHaveBeenCalledTimes(1);
			expect(reported).toHaveBeenCalledTimes(1);
			await until(() => !kept().sessions.has(pid));

			// The session is gone: asked for again, there is nothing to hand back.
			const again = await recover(pid, offsets[0], { query: { ...ROOM_QUERY, peerId: 'other' } });

			expect(again.socket.recovered).toBe(false);
			expect(again.received).toEqual([]);
		});

		// Too many reconnects, or the peer has left meanwhile.
		test('and refused there, is cut and forgotten', async () => {
			const { pid, offsets } = await dropped([ 'a', 'b' ], { query: ROOM_QUERY });

			let terminated: jest.SpyInstance | undefined;

			handleConnection.mockImplementationOnce(async () => {
				const { transport } = sockets[sockets.length - 1].conn as unknown as { transport: { socket: { terminate: () => void } } };

				terminated = jest.spyOn(transport.socket, 'terminate');

				throw new Error('Too many reconnects');
			});

			const refused = await recover(pid, offsets[0], { query: ROOM_QUERY });

			await until(() => refused.ended.reason !== '');
			await until(() => (refused.socket.conn as unknown as { readyState: string }).readyState === 'closed');

			expect(refused.socket.recovered).toBe(true);
			// Not a close that waits for the client to take what it was sent.
			expect(terminated).toHaveBeenCalled();
			expect(kept().sessions.has(pid)).toBe(false);
		});
	});

	test('whose client does not read what is handed back is cut once nothing goes out for stallMs', async () => {
		IOServerConnection.stallBytes = 100_000;
		IOServerConnection.stallMs = 200;

		const { pid, offsets } = await dropped([ 'a', ...Array.from({ length: 100 }, () => 'z'.repeat(100_000)) ]);
		let gone = false;

		onConnection = (socket) => {
			socket.once('disconnect', () => {
				gone = true;
			});
			connections.push(new IOServerConnection(socket));
		};

		const again = client({ auth: { pid, offset: offsets[0] }, autoConnect: false });

		again.io.on('open', () =>
			(again.io.engine.transport as unknown as { ws: { _socket: { pause: () => void } } }).ws._socket.pause());
		again.connect();

		await until(() => gone);
		expect(sockets.at(-1)?.recovered).toBe(true);
	}, 20_000);
});

describe('the client-facing socket.io server', () => {
	test('takes WebSocket only: what waits for a client that does not read is measured on it alone', async () => {
		const httpServer = http.createServer();
		const server = new Server(httpServer, socketServerOptions);

		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

		const polling = ioClient(`http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`, { reconnection: false, transports: [ 'polling' ] });
		const failed = await new Promise<boolean>((resolve) => {
			polling.once('connect', () => resolve(false));
			polling.once('connect_error', () => resolve(true));
		});

		polling.close();
		server.close();
		await new Promise((resolve) => httpServer.close(resolve));

		expect(failed).toBe(true);
	});
});
