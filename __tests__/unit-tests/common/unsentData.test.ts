import 'jest';
import http from 'http';
import { EventEmitter } from 'events';
import { AddressInfo } from 'net';
import { Server, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { IOServerConnection } from '../../../src/common/IOServerConnection';

// What is sent to a client waits in the server's memory until the client has read it.
describe('a client that does not read', () => {
	const maxUnsentBytes = IOServerConnection.maxUnsentBytes;
	const stallMs = IOServerConnection.stallMs;
	const stallBytes = IOServerConnection.stallBytes;
	const chunk = 'x'.repeat(100_000);
	let httpServer: http.Server;
	let server: Server;
	let url: string;
	let connections: IOServerConnection[];
	let sockets: Socket[];

	beforeEach(async () => {
		connections = [];
		sockets = [];
		httpServer = http.createServer();
		server = new Server(httpServer, {
			connectionStateRecovery: { maxDisconnectionDuration: 60_000, skipMiddlewares: true },
		});
		server.on('connection', (socket: Socket) => {
			sockets.push(socket);
			connections.push(new IOServerConnection(socket));
		});
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
		IOServerConnection.maxUnsentBytes = 1_000_000;
	});

	afterEach(async () => {
		IOServerConnection.maxUnsentBytes = maxUnsentBytes;
		IOServerConnection.stallMs = stallMs;
		IOServerConnection.stallBytes = stallBytes;
		connections.forEach((connection) => connection.close());
		server.close();
		await new Promise((resolve) => httpServer.close(resolve));
	});

	const until = (check: () => boolean) => new Promise<void>((resolve) => {
		const poll = () => (check() ? resolve() : setTimeout(poll, 5));

		poll();
	});
	const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

	const connect = async () => {
		const client: ClientSocket = ioClient(url, { reconnection: false, transports: [ 'websocket' ] });

		await until(() => connections.length === 1 && client.connected);

		return { client, connection: connections[0], socket: sockets[0] };
	};

	// The client's TCP socket stops reading; the server's buffers fill.
	const stopReading = (client: ClientSocket) =>
		(client.io.engine.transport as unknown as { ws: { _socket: { pause: () => void } } }).ws._socket.pause();

	test('is cut once more than maxUnsentBytes wait', async () => {
		const { client, connection, socket } = await connect();
		let reason = '';

		socket.on('disconnect', (why: string) => {
			reason = why;
		});
		stopReading(client);

		for (let i = 0; i < 500 && socket.connected; i++) {
			connection.notify({ method: 'big', data: chunk });
			await nextTurn();
		}

		// What a network failure gives: the peer has its reconnect window, as after any drop.
		await until(() => reason !== '');
		expect(reason).toMatch(/^transport (close|error)$/);
		client.close();
	});

	// A graceful close waits for the client to read what is queued, which it never does.
	test('closed while data waits and nothing goes out, it is cut after stallMs, and its session is not kept', async () => {
		IOServerConnection.maxUnsentBytes = Number.MAX_SAFE_INTEGER;
		IOServerConnection.stallMs = 200;

		const { client, connection, socket } = await connect();
		let gone = false;

		(socket.conn as unknown as EventEmitter).once('close', () => {
			gone = true;
		});
		stopReading(client);

		for (let i = 0; i < 100; i++) {
			connection.notify({ method: 'big', data: chunk });
			await nextTurn();
		}

		expect(connection.unsentBytes).toBeGreaterThan(0);

		connection.close();
		await until(() => gone);

		expect((server.of('/').adapter as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0);
		client.close();
	});

	test('open, with more than stallBytes waiting and nothing going out, it is cut after stallMs and says so', async () => {
		IOServerConnection.maxUnsentBytes = Number.MAX_SAFE_INTEGER;
		IOServerConnection.stallBytes = 100_000;
		IOServerConnection.stallMs = 200;

		const { client, connection, socket } = await connect();
		let notReading = 0;
		let reason = '';

		(connection as unknown as EventEmitter).on('notReading', () => notReading++);
		socket.on('disconnect', (why: string) => {
			reason = why;
		});
		stopReading(client);

		for (let i = 0; i < 100 && socket.connected; i++) {
			connection.notify({ method: 'big', data: chunk });
			await nextTurn();
		}

		await until(() => reason !== '');
		expect(reason).toMatch(/^transport (close|error)$/);
		expect(notReading).toBe(1);
		client.close();
	});

	// One large message goes out for longer than stallMs; while it does, only the system's
	// queue gets less.
	test('a client that reads one large message slowly is not cut, also after a close, and gets what was sent last', async () => {
		IOServerConnection.maxUnsentBytes = Number.MAX_SAFE_INTEGER;
		IOServerConnection.stallBytes = 100_000;
		IOServerConnection.stallMs = 600;

		const { client, connection } = await connect();
		const received: string[] = [];
		let reason = '';
		let notReading = 0;

		(connection as unknown as EventEmitter).on('notReading', () => notReading++);
		client.on('notification', (n: { method: string }) => received.push(n.method));
		client.on('disconnect', (why: string) => {
			reason = why;
		});

		const tcp = (client.io.engine.transport as unknown as { ws: { _socket: EventEmitter & { pause: () => void; resume: () => void } } }).ws._socket;
		const startedAt = Date.now();

		tcp.on('data', () => {
			tcp.pause();
			setTimeout(() => tcp.resume(), 5);
		});

		connection.notify({ method: 'big', data: 'x'.repeat(30_000_000) });
		connection.notify({ method: 'kicked', data: {} });
		connection.close();

		await until(() => reason !== '');
		expect(Date.now() - startedAt).toBeGreaterThan(IOServerConnection.stallMs);
		expect(received).toEqual([ 'big', 'kicked' ]);
		expect(reason).toBe('io server disconnect');
		expect(notReading).toBe(0);
	}, 30_000);

	test('a client that reads is not cut, however much it is sent', async () => {
		const { client, connection } = await connect();
		let received = 0;

		client.on('notification', () => received++);

		for (let i = 0; i < 50; i++) {
			connection.notify({ method: 'big', data: chunk });
			connection.notifyOnce({ method: 'big', data: chunk });
			await until(() => received === 2 * (i + 1));
		}

		expect(client.connected).toBe(true);
		client.close();
	});

	// A kick or a refusal is the last thing sent before the close, in the same turn.
	test('what was sent right before a close reaches a client that reads, which is told to leave', async () => {
		const { client, connection } = await connect();
		const received: string[] = [];
		let reason = '';

		client.on('notification', (n: { method: string }) => received.push(n.method));
		client.on('disconnect', (why: string) => {
			reason = why;
		});

		connection.notify({ method: 'big', data: chunk });
		connection.notify({ method: 'kicked', data: {} });
		connection.close();

		await until(() => reason !== '');
		expect(received).toEqual([ 'big', 'kicked' ]);
		expect(reason).toBe('io server disconnect');
	});

	test('answers to its requests count as well', async () => {
		const { client, connection, socket } = await connect();

		// eslint-disable-next-line no-unused-vars
		connection.on('request', (_request: unknown, respond: (answer: unknown) => void) => respond({ echo: chunk }));
		stopReading(client);

		for (let i = 0; i < 500 && socket.connected; i++) {
			client.emit('request', { method: 'echo' }, () => undefined);
			await nextTurn();
		}

		await until(() => !socket.connected);
		expect(socket.connected).toBe(false);
	});

	test('more queued packets than maxUnsentPackets count as too much, without adding them up', () => {
		const writeBuffer = Array.from({ length: IOServerConnection.maxUnsentPackets + 1 }, () => ({ data: 'x' }));
		const socket = { on: jest.fn(), once: jest.fn(), conn: { writeBuffer }, handshake: { address: '', headers: {} } };
		const connection = new IOServerConnection(socket as unknown as Socket);

		expect(connection.unsentBytes).toBe(Number.POSITIVE_INFINITY);
		writeBuffer.length = 3;
		expect(connection.unsentBytes).toBe(3);
	});
});
