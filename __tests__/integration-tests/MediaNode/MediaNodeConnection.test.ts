import 'jest';
import { DrainingError, MediaNodeConnection, TimeoutError } from '../../../src/media/MediaNodeConnection';
import { drainGreeting, startFakeMediaNode, startSilentPort } from './fakeMediaNode';

/**
 * No external dependencies: every case runs against a socket.io server this suite
 * starts itself on a free port.
 */

jest.setTimeout(30000);

test('a connection can be closed before it is ready', () => {
	const sut = new MediaNodeConnection({ url: 'wss://127.0.0.1:1', timeout: 500 });

	expect(sut.closed).toBe(false);
	sut.close();
	expect(sut.closed).toBe(true);
});

test('a media node that never answers leaves the connection with a timeout', async () => {
	const silent = await startSilentPort();
	const sut = new MediaNodeConnection({ url: `wss://${silent.host}:${silent.port}`, timeout: 500 });

	// ready never rejects: it is a safePromise, so it resolves to [ error, value ].
	const [ error ] = await sut.ready;

	expect(error).toBeInstanceOf(TimeoutError);
	expect(error?.message).toContain('connection timed out');

	sut.close();
	await silent.close();
});

test('a media node that greets makes the connection ready', async () => {
	const node = await startFakeMediaNode();
	const sut = new MediaNodeConnection({ url: node.url, timeout: 3000 });

	const [ error ] = await sut.ready;

	expect(error).toBeNull();

	sut.close();
	await node.close();
});

test('a media node that is draining is reported as such, not as a timeout', async () => {
	// The node greets with a drain notice instead of readiness.
	const node = await startFakeMediaNode({ greeting: drainGreeting });
	const sut = new MediaNodeConnection({ url: node.url, timeout: 3000 });
	const draining = new Promise<void>((resolve) => sut.once('draining', () => resolve()));

	const [ error ] = await sut.ready;

	expect(error).toBeInstanceOf(DrainingError);
	await draining;

	sut.close();
	await node.close();
});
