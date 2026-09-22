import { SocketMessage } from 'edumeet-common';
import { readFileSync } from 'fs';
import https from 'node:https';
import { AddressInfo } from 'net';
import path from 'path';
import { Server as IOServer } from 'socket.io';

/* eslint-disable no-unused-vars */
export type Respond = (serverError: unknown, data: unknown) => void;

// What a media node answers a request with. Call respond(null, data) to answer, or
// respond('Server error', null) to fail the request the way a media node does.
export type RequestHandler = (request: SocketMessage, respond: Respond, connection: number) => void;
/* eslint-enable no-unused-vars */

export interface FakeMediaNodeOptions {
	// What the node announces on connect. mediaNodeReady is what lets
	// MediaNodeConnection.ready settle; null makes the server accept the socket and stay
	// silent, so the client is left to time out.
	greeting?: SocketMessage | null;
	onRequest?: RequestHandler;
}

export const readyGreeting: SocketMessage = { method: 'mediaNodeReady', data: { workers: 2, load: 1 } };
export const drainGreeting: SocketMessage = { method: 'mediaNodeDrain' };

export interface FakeMediaNode {
	host: string;
	port: number;
	url: string;
	connections: number;
	// Read on every connection, so a test can take the node down and bring it back.
	greeting: SocketMessage | null;
	close: () => Promise<void>;
}

const certs = () => ({
	cert: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-cert.pem')),
	key: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-key.pem'))
});

// A socket.io server that speaks just enough of the media node protocol for the room
// server to talk to it: it greets with mediaNodeReady and answers requests the way the
// test asks it to. Port 0 lets the OS pick a free one, so parallel suites cannot clash.
export const startFakeMediaNode = async ({ greeting = readyGreeting, onRequest }: FakeMediaNodeOptions = {}): Promise<FakeMediaNode> => {
	const httpsServer = https.createServer(certs());

	await new Promise<void>((resolve) => httpsServer.listen({ host: '127.0.0.1', port: 0 }, resolve));

	const { address, port } = httpsServer.address() as AddressInfo;
	const ioServer = new IOServer(httpsServer);
	const node: FakeMediaNode = {
		host: address,
		port,
		url: `wss://${address}:${port}`,
		connections: 0,
		greeting,
		close: async () => {
			ioServer.disconnectSockets(true);
			await new Promise<void>((resolve) => ioServer.close(() => resolve()));
			await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
		}
	};

	ioServer.on('connection', (socket) => {
		const connection = ++node.connections;

		if (node.greeting) socket.emit('notification', node.greeting);

		socket.on('request', (request: SocketMessage, respond: Respond) => onRequest?.(request, respond, connection));
	});

	return node;
};

// A TLS port that accepts the socket but never speaks socket.io, so a connection
// attempt neither succeeds nor is refused: the client is left to time out.
export const startSilentPort = async (): Promise<{ host: string, port: number, close: () => Promise<void> }> => {
	const httpsServer = https.createServer(certs(), (_req, res) => res.writeHead(400).end());

	await new Promise<void>((resolve) => httpsServer.listen({ host: '127.0.0.1', port: 0 }, resolve));

	const { address, port } = httpsServer.address() as AddressInfo;

	return {
		host: address,
		port,
		close: async () => { await new Promise<void>((resolve) => httpsServer.close(() => resolve())); }
	};
};

// Waits for a condition the code under test reaches on its own, without pinning the test
// to a sleep length.
export const until = async (what: () => boolean, timeoutMs = 10000): Promise<void> => {
	const deadline = Date.now() + timeoutMs;

	while (!what()) {
		if (Date.now() > deadline) throw new Error('condition was not reached in time');

		await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
	}
};
