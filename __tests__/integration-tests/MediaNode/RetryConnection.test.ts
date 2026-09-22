import 'jest';
import { KDPoint } from 'edumeet-common';
import { MediaNode } from '../../../src/media/MediaNode';
import { FakeMediaNode, readyGreeting, startFakeMediaNode, until } from './fakeMediaNode';

/**
 * No external dependencies: the media node this suite talks to is a socket.io server it
 * starts itself on a free port.
 */

jest.setTimeout(60000);

const connectTo = (fake: FakeMediaNode): MediaNode => new MediaNode({
	id: 'mediaNodeId',
	hostname: fake.host,
	port: fake.port,
	secret: 'secret',
	turnports: [],
	kdPoint: new KDPoint([ 50, 10 ])
});

test('a node that does not answer on connect is marked unhealthy, and healthy again once it does', async () => {
	// The node accepts the socket but never announces itself, so connecting times out.
	const fake = await startFakeMediaNode({ greeting: null });
	const sut = connectTo(fake);

	await until(() => !sut.healthy);
	expect(sut.healthy).toBe(false);

	fake.greeting = readyGreeting;
	await sut.healthCheck();

	expect(sut.healthy).toBe(true);

	sut.close();
	await fake.close();
});

test('a node whose request times out is marked unhealthy, and serves routers again after it recovers', async () => {
	let answering = false;
	const fake = await startFakeMediaNode({
		onRequest: (request, respond) => {
			if (!answering) return; // the request is left hanging, as a lost packet would leave it

			respond(null, { id: `router-for-${request.data?.roomId}`, rtpCapabilities: {} });
		}
	});
	const sut = connectTo(fake);

	await until(() => sut.healthy);

	await expect(sut.getRouter({ roomId: 'roomId' })).rejects.toThrow('Request timed out');
	expect(sut.healthy).toBe(false);

	answering = true;
	await sut.healthCheck();

	expect(sut.healthy).toBe(true);

	const router = await sut.getRouter({ roomId: 'roomId', appData: { pipePromises: new Map() } });

	expect(router.id).toBe('router-for-roomId');
	expect(router.closed).toBe(false);

	sut.close();
	await fake.close();
});
