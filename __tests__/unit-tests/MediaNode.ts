import { KDPoint } from 'edumeet-common';
import 'jest';
import MediaNode from '../../src/media/MediaNode';
import { MediaNodeConnection } from '../../src/media/MediaNodeConnection';

describe('MediaNode', () => {
	let mediaNode: MediaNode;
	const roomId = 'testRoomId';
	const roomId2 = 'testRoomId2';
	const fakePoint = {} as unknown as KDPoint;

	beforeEach(() => {
		mediaNode = new MediaNode({
			id: 'testId',
			hostname: 'testHostname',
			port: 1234,
			secret: 'testSecret',
			kdPoint: fakePoint
		});

		mediaNode.connection = {
			ready: Promise.resolve(),
			close: jest.fn(),
			notify: jest.fn(),
			request: jest.fn(async ({ method, data }) => {
				if (method === 'getRouter') {
					expect(data.roomId).toBeDefined();

					return {
						id: data.roomId,
						rtpCapabilities: {},
					};
				}
			}),
			on: jest.fn(),
			once: jest.fn(),
			pipeline: {
				use: jest.fn(),
				remove: jest.fn(),
				execute: jest.fn(),
			},
		} as unknown as MediaNodeConnection;
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(mediaNode.closed).toBe(false);
	});

	it('close()', () => {
		mediaNode.close();
		expect(mediaNode.closed).toBe(true);
		expect(mediaNode.routers.size).toBe(0);
	});

	it('getRouter()', async () => {
		const router = await mediaNode.getRouter({
			roomId,
			appData: {},
		});

		expect(router.id).toBe(roomId);
		expect(mediaNode.routers.size).toBe(1);
	});

	it('getRouter() - two room ids', async () => {
		const router = await mediaNode.getRouter({
			roomId,
			appData: {},
		});

		expect(router.id).toBe(roomId);
		expect(mediaNode.routers.size).toBe(1);

		const router2 = await mediaNode.getRouter({
			roomId: roomId2,
			appData: {},
		});

		expect(router2.id).toBe(roomId2);
		expect(mediaNode.routers.size).toBe(2);
	});

	it('getRouter() - two room ids, close one', async () => {
		const router = await mediaNode.getRouter({
			roomId,
			appData: {},
		});

		expect(router.id).toBe(roomId);
		expect(mediaNode.routers.size).toBe(1);

		const router2 = await mediaNode.getRouter({
			roomId: roomId2,
			appData: {},
		});

		expect(router2.id).toBe(roomId2);
		expect(mediaNode.routers.size).toBe(2);

		router.close();
		expect(mediaNode.routers.size).toBe(1);
	});

	it('getRouter() - two room ids, close both', async () => {
		const router = await mediaNode.getRouter({
			roomId,
			appData: {},
		});

		expect(router.id).toBe(roomId);
		expect(mediaNode.routers.size).toBe(1);

		const router2 = await mediaNode.getRouter({
			roomId: roomId2,
			appData: {},
		});

		expect(router2.id).toBe(roomId2);
		expect(mediaNode.routers.size).toBe(2);

		router.close();
		expect(mediaNode.routers.size).toBe(1);

		router2.close();
		expect(mediaNode.routers.size).toBe(0);

		// No more routers left, so the connection should be closed.
		expect(mediaNode.connection).toBeUndefined();
	});

	it('getRouter() - should reject on failing medianode connection', async () => {
		const mockConnection = {
			ready: Promise.reject('timeout'),
			close: jest.fn()
		} as unknown as MediaNodeConnection;

		mediaNode.connection = mockConnection;
		await expect(mediaNode.getRouter({
			roomId,
			appData: {},
		})).rejects.toBe('timeout');
	});
});