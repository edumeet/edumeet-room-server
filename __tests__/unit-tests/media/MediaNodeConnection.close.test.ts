import 'jest';
import net from 'net';
import { ConnectionError, MediaNodeConnection } from '../../../src/media/MediaNodeConnection';

test('closing a connection before it is ready settles ready', async () => {
	const accepted = new Set<net.Socket>();
	const silentServer = net.createServer((socket) => accepted.add(socket));

	await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));

	const { port } = silentServer.address() as net.AddressInfo;
	const connection = new MediaNodeConnection({ url: `wss://127.0.0.1:${port}`, timeout: 10_000 });

	setTimeout(() => connection.close(), 50);

	const startedAt = Date.now();
	const [ error ] = await connection.ready;

	accepted.forEach((socket) => socket.destroy());
	await new Promise<void>((resolve) => silentServer.close(() => resolve()));

	expect(error).toBeInstanceOf(ConnectionError);
	expect(Date.now() - startedAt).toBeLessThan(2_000);
});
