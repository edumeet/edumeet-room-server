import 'jest';
import http from 'http';
import { AddressInfo } from 'net';
import { Server, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { socketServerOptions } from '../../../src/common/socketServerOptions';
import { IOServerConnection } from '../../../src/common/IOServerConnection';
import { socketHandler } from '../../../src/common/socketHandler';

type Kept = { sessions: Map<string, unknown>; packets: Array<{ emittedAt: number }> };

// What socket.io hands a client that recovers its session after a drop.
describe('a recovered session', () => {
	const maxUnsentBytes = IOServerConnection.maxUnsentBytes;
	const stallBytes = IOServerConnection.stallBytes;
	const stallMs = IOServerConnection.stallMs;
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
		onConnection = () => undefined;
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
	const dropped = async (notifications: string[]) => {
		const first = client();
		const offsets: string[] = [];

		first.on('notification', (_n: unknown, offset: string) => offsets.push(offset));
		await until(() => sockets.length === 1 && first.connected);

		const pid = (first as unknown as { _pid: string })._pid;

		notifications.forEach((data) => sockets[0].emit('notification', { method: 'note', data }));
		await until(() => offsets.length === notifications.length);

		const gone = new Promise((resolve) => sockets[0].once('disconnect', resolve));

		(first.io.engine as unknown as { close: () => void }).close();
		await gone;

		return { pid, offsets };
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
