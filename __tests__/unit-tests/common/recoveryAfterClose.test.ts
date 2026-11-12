import 'jest';
import http from 'http';
import { AddressInfo } from 'net';
import { Server, Socket } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { IOServerConnection } from '../../../src/common/IOServerConnection';

// socket.io keeps the packets of a dropped socket for connection state recovery. A peer the
// room server has closed must not get them, nor what was sent after it was removed.
describe('connection state recovery', () => {
	let httpServer: http.Server;
	let server: Server;
	let url: string;
	let connections: IOServerConnection[];

	beforeEach(async () => {
		connections = [];
		httpServer = http.createServer();
		server = new Server(httpServer, {
			connectionStateRecovery: { maxDisconnectionDuration: 60_000, skipMiddlewares: true },
		});
		server.on('connection', (socket: Socket) => {
			if (!socket.recovered) connections.push(new IOServerConnection(socket));
		});
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		server.close();
		await new Promise((resolve) => httpServer.close(resolve));
	});

	const until = (check: () => boolean) => new Promise<void>((resolve) => {
		const poll = () => (check() ? resolve() : setTimeout(poll, 5));

		poll();
	});

	const dropAndBuffer = async () => {
		const client: ClientSocket = ioClient(url, { reconnection: false, transports: [ 'websocket' ] });
		const received: string[] = [];

		client.on('notification', (n: { method: string }) => received.push(n.method));
		await until(() => connections.length === 1 && client.connected);

		const [ connection ] = connections;

		// The client learns an offset to recover from.
		connection.notify({ method: 'first', data: {} });
		await until(() => received.includes('first'));

		// The transport drops; socket.io keeps the session.
		client.io.engine.close();
		await until(() => !client.connected && connection.disconnected);

		// Sent while the client is away: buffered for recovery.
		connection.notify({ method: 'whileAway', data: {} });

		return { client, received, connection };
	};

	test('replays what was missed while the peer is still in its room', async () => {
		const { client, received } = await dropAndBuffer();

		client.connect();
		await until(() => client.connected);
		await until(() => received.includes('whileAway'));

		expect(client.recovered).toBe(true);
		client.close();
	});

	// A copy of a room's state is megabytes, and a client can ask for one with every reconnect.
	describe('notifyOnce', () => {
		const stored = () => (server.of('/').adapter as unknown as { packets: unknown[] }).packets.length;

		const connectOne = async () => {
			const client: ClientSocket = ioClient(url, { reconnection: false, transports: [ 'websocket' ] });
			const received: Array<{ method: string, data: { chatHistory?: string[] } }> = [];

			client.on('notification', (n) => received.push(n));
			await until(() => connections.length === 1 && client.connected);

			return { client, received, connection: connections[0] };
		};

		test('reaches the client and is not kept, while notify is', async () => {
			const { client, received, connection } = await connectOne();

			for (let i = 0; i < 50; i++) connection.notifyOnce({ method: 'peerReconnected', data: { chatHistory: [ 'x'.repeat(1000) ] } });
			await until(() => received.length === 50);
			expect(stored()).toBe(0);

			connection.notify({ method: 'kept', data: {} });
			expect(stored()).toBe(1);
			client.close();
		});

		test('sends the state as it is at the call', async () => {
			const { client, received, connection } = await connectOne();
			const chatHistory = [ 'before' ];

			connection.notifyOnce({ method: 'peerReconnected', data: { chatHistory } });
			chatHistory.push('after');
			await until(() => received.length === 1);

			expect(received[0].data.chatHistory).toEqual([ 'before' ]);
			client.close();
		});

		test('is not sent again when the socket recovers', async () => {
			const { client, received, connection } = await connectOne();

			connection.notify({ method: 'first', data: {} });
			connection.notifyOnce({ method: 'peerReconnected', data: {} });
			await until(() => received.length === 2);

			client.io.engine.close();
			await until(() => !client.connected && connection.disconnected);

			// lost with the socket, and not kept either
			connection.notifyOnce({ method: 'sessionIdChanged', data: {} });
			connection.notify({ method: 'whileAway', data: {} });

			client.connect();
			await until(() => received.some((n) => n.method === 'whileAway'));

			expect(client.recovered).toBe(true);
			expect(received.map((n) => n.method)).toEqual([ 'first', 'peerReconnected', 'whileAway' ]);
			client.close();
		});

		test('does nothing on a closed connection', async () => {
			const { client, connection } = await connectOne();

			connection.close();
			expect(() => connection.notifyOnce({ method: 'peerReconnected', data: {} })).not.toThrow();
			client.close();
		});
	});

	test('restores nothing once the connection was closed', async () => {
		const { client, received, connection } = await dropAndBuffer();

		// The reconnect window ran out, or the peer was kicked meanwhile.
		connection.close();

		client.connect();
		await until(() => client.connected);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(client.recovered).toBe(false);
		expect(received).toEqual([ 'first' ]);
		client.close();
	});
});
