import 'jest';
import { Socket } from 'socket.io';
import { socketHandler } from '../../src/common/socketHandler';

describe('Server', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Handles query parameters', () => {
		const socket = {
			id: 'socketId',
			handshake: {
				query: {
					roomId: 'roomId',
					peerId: 'peerId',
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