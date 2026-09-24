import 'jest';
import { Socket } from 'socket.io';
import { socketHandler } from '../../src/common/socketHandler';
import ServerManager from '../../src/ServerManager';

describe('Server', () => {
	beforeAll(() => {
		// socketHandler hands valid connections off to the global serverManager.
		global.serverManager = {
			handleConnection: jest.fn().mockResolvedValue(undefined),
		} as unknown as ServerManager;
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Passes the bot token from the handshake body and the bot type from the query', () => {
		const socket = {
			id: 'socketId',
			handshake: {
				query: { roomId: 'r', peerId: 'p', reconnectKey: 'k', headless: '1', botType: 'recorder' },
				auth: { botToken: 'secret' },
				headers: { host: 'tenant.example.com' },
			},
			on: jest.fn(),
			once: jest.fn(),
			removeAllListeners: jest.fn(),
			disconnect: jest.fn(),
		} as unknown as Socket;

		socketHandler(socket);

		const args = (global.serverManager.handleConnection as jest.Mock).mock.calls.at(-1);

		expect(args.slice(8)).toEqual([ true, 'secret', 'recorder' ]);
	});

	it('Passes a bot id from the query only when it is a uuid, and not the job id of the old contract', () => {
		const botId = '5B2F1C1E-0000-4000-8000-000000000000';
		const connect = (query: Record<string, string>) => {
			socketHandler({
				id: 'socketId',
				handshake: {
					query: { roomId: 'r', peerId: 'p', reconnectKey: 'k', headless: '1', ...query },
					auth: { botToken: 'secret' },
					headers: { host: 'tenant.example.com' },
				},
				on: jest.fn(),
				once: jest.fn(),
				removeAllListeners: jest.fn(),
				disconnect: jest.fn(),
			} as unknown as Socket);

			return (global.serverManager.handleConnection as jest.Mock).mock.calls.at(-1)[12];
		};

		expect(connect({ botId })).toBe(botId.toLowerCase());
		expect(connect({ botId: '../etc' })).toBeUndefined();
		expect(connect({ jobId: botId })).toBeUndefined();
	});

	it('Handles query parameters', () => {
		const socket = {
			id: 'socketId',
			handshake: {
				query: {
					roomId: 'roomId',
					peerId: 'peerId',
					reconnectKey: 'reconnectKey',
				},
				headers: {
					host: 'tenant.example.com',
				},
			},
			on: jest.fn(),
			once: jest.fn(),
			removeAllListeners: jest.fn(),
			disconnect: jest.fn(),
		} as unknown as Socket;

		socketHandler(socket);

		expect(socket.disconnect).not.toHaveBeenCalled();
	});

	it('Handles missing query parameters', () => {
		const socket = {
			id: 'socketId',
			handshake: {
				query: {},
			},
			on: jest.fn(),
			once: jest.fn(),
			removeAllListeners: jest.fn(),
			disconnect: jest.fn(),
		} as unknown as Socket;

		socketHandler(socket);

		expect(socket.disconnect).toHaveBeenCalled();
	});

	it('Handles missing roomId', () => {
		const socket = {
			id: 'socketId',
			handshake: {
				query: {
					peerId: 'peerId',
				},
			},
			on: jest.fn(),
			once: jest.fn(),
			removeAllListeners: jest.fn(),
			disconnect: jest.fn(),
		} as unknown as Socket;

		socketHandler(socket);

		expect(socket.disconnect).toHaveBeenCalled();
	});

	it('Handles missing peerId', () => {
		const socket = {
			id: 'socketId',
			handshake: {
				query: {
					roomId: 'roomId',
				},
			},
			on: jest.fn(),
			once: jest.fn(),
			removeAllListeners: jest.fn(),
			disconnect: jest.fn(),
		} as unknown as Socket;

		socketHandler(socket);

		expect(socket.disconnect).toHaveBeenCalled();
	});
});