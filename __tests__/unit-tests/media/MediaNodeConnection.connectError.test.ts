import 'jest';
import net from 'net';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { MediaNodeConnection, TimeoutError } from '../../../src/media/MediaNodeConnection';

test('connection timeout carries the last connect error', async () => {
	const connection = new MediaNodeConnection({ url: 'wss://127.0.0.1:1', timeout: 1500 });

	const [ error ] = await connection.ready;

	connection.close();

	expect(error).toBeInstanceOf(TimeoutError);
	expect(error?.message).toMatch(/connection timed out \[lastError: .*ECONNREFUSED/);
});

test('connection timeout with nothing answering carries no connect error', async () => {
	// Accepts TCP but never speaks, so no transport error is reported before the timeout.
	const accepted = new Set<net.Socket>();
	const silentServer = net.createServer((socket) => accepted.add(socket));

	await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));

	const { port } = silentServer.address() as net.AddressInfo;
	const connection = new MediaNodeConnection({ url: `wss://127.0.0.1:${port}`, timeout: 500 });

	const [ error ] = await connection.ready;

	connection.close();
	accepted.forEach((socket) => socket.destroy());
	await new Promise<void>((resolve) => silentServer.close(() => resolve()));

	expect(error).toBeInstanceOf(TimeoutError);
	expect(error?.message).toBe('connection timed out');
});

describe('TLS of the media node connection', () => {
	// A self-signed certificate for 127.0.0.1, made for these tests only.
	const fixtures = path.join(__dirname, '..', '..', 'fixtures');
	const cert = fs.readFileSync(path.join(fixtures, 'media-node-test.crt'), 'utf8');
	const key = fs.readFileSync(path.join(fixtures, 'media-node-test.key'), 'utf8');

	// Records every request that reaches the node, and so whether the secret was sent.
	const startNode = async () => {
		const seen: string[] = [];
		const server = https.createServer({ cert, key }, (req, res) => {
			seen.push(req.url ?? '');
			res.end();
		});

		server.on('upgrade', (req, socket) => {
			seen.push(req.url ?? '');
			socket.destroy();
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

		const { port } = server.address() as net.AddressInfo;
		const stop = () => new Promise<void>((resolve) => server.close(() => resolve()));

		return { seen, port, stop };
	};

	test('with validation and an untrusted certificate, the secret is never sent', async () => {
		const node = await startNode();
		const connection = new MediaNodeConnection({ url: `wss://127.0.0.1:${node.port}`, secret: 's3cret', timeout: 1500, rejectUnauthorized: true });

		const [ error ] = await connection.ready;

		connection.close();
		await node.stop();

		expect(error?.message).toMatch(/certificate/i);
		expect(node.seen.filter((url) => url.includes('s3cret'))).toEqual([]);
	});

	test('with the node\'s certificate as CA, the connection reaches the node', async () => {
		const node = await startNode();
		const connection = new MediaNodeConnection({ url: `wss://127.0.0.1:${node.port}`, secret: 's3cret', timeout: 1500, rejectUnauthorized: true, ca: cert });

		await connection.ready;
		connection.close();
		await node.stop();

		expect(node.seen.some((url) => url.includes('s3cret'))).toBe(true);
	});
});
