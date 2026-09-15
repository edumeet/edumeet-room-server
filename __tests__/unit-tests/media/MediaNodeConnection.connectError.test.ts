import 'jest';
import net from 'net';
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
