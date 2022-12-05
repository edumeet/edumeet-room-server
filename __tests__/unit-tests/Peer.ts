const mockLoggerDebug = jest.fn();
const mockLoggerError= jest.fn();
const mockLoggerWarn= jest.fn();

jest.mock('edumeet-common', () => {
	const originalModule = jest.requireActual('edumeet-common');
	
	return {
		...originalModule,
		Logger: jest.fn().mockImplementation(() => {
			return {
				debug: mockLoggerDebug,
				error: mockLoggerError,
				warn: mockLoggerWarn
			};
		})
	}; 
});

import { BaseConnection, IOServerConnection, SocketMessage } from 'edumeet-common';
import 'jest';
import { Socket } from 'socket.io';
import { userRoles } from '../../src/common/authorization';
import { Peer, PeerContext } from '../../src/Peer';
import { Producer } from '../../src/media/Producer';
import { Consumer } from '../../src/media/Consumer';
import { WebRtcTransport } from '../../src/media/WebRtcTransport';
import { Router } from '../../src/media/Router';
import EventEmitter from 'events';
import { Pipeline } from 'edumeet-common';

describe('Peer', () => {
	let connection: BaseConnection;
	let peer: Peer;
	let spyEmit: jest.SpyInstance;

	const mockSocket = {
		id: 'testSocket',
		join: jest.fn(),
		leave: jest.fn(),
		to: jest.fn(),
		emit: jest.fn(),
		on: jest.fn(),
		once: jest.fn(),
		removeAllListeners: jest.fn(),
		broadcast: {
			to: jest.fn(() => mockSocket),
			emit: jest.fn()
		}
	} as unknown as Socket;

	const roomId = 'testRoom';
	const peerId = 'testPeer';
	const displayName = 'testDisplayName';
	const picture = 'testPicture';

	beforeEach(() => {
		connection = new IOServerConnection(mockSocket);

		peer = new Peer({
			id: peerId,
			roomId,
			displayName,
			picture,
			connection
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(peer.id).toBe(peerId);
		expect(peer.closed).toBe(false);
		expect(peer.displayName).toBe(displayName);
		expect(peer.picture).toBe(picture);
		expect(peer.roomId).toBe(roomId);
		expect(peer.connections.items[0]).toBe(connection);
		expect(peer.token).toBeDefined();
	});

	it('close()', () => {
		spyEmit = jest.spyOn(peer, 'emit');

		peer.close();
		expect(peer.closed).toBe(true);
		expect(peer.connections.items.length).toBe(0);
		expect(peer.producers.size).toBe(0);
		expect(peer.consumers.size).toBe(0);
		expect(peer.transports.size).toBe(0);
		expect(spyEmit).toHaveBeenCalledTimes(1);
	});

	it('close() - should close producers', async () => {
		const producerToClose = {
			id: 1,
			close: jest.fn()
		} as unknown as Producer;
		const spyCloseProducer = jest.spyOn(producerToClose, 'close');

		peer.producers.set(producerToClose.id, producerToClose);
		peer.close();
		expect(spyCloseProducer).toHaveBeenCalled();
	});

	it('close() - should close consumers', async () => {
		const consumerToClose = {
			id: 'id',
			close: jest.fn()
		} as unknown as Consumer;
		const spyCloseConsumer = jest.spyOn(consumerToClose, 'close');

		peer.consumers.set(consumerToClose.id, consumerToClose);
		peer.close();
		expect(spyCloseConsumer).toHaveBeenCalled();
	});

	it('close() - should close transports', async () => {
		const transportToClose = {
			id: 'id',
			close: jest.fn()
		} as unknown as WebRtcTransport;
		const spyCloseTransport = jest.spyOn(transportToClose, 'close');

		peer.transports.set(transportToClose.id, transportToClose);
		peer.close();
		expect(spyCloseTransport).toHaveBeenCalled();
	});

	it('set raisedHand()', () => {
		expect(peer.raisedHandTimestamp).toBeUndefined();

		peer.raisedHand = true;

		expect(peer.raisedHand).toBe(true);
		expect(peer.raisedHandTimestamp).toBeDefined();
	});

	it('addRole() - can\'t add normal', () => {
		expect(peer.roles.filter((r) => r === userRoles.NORMAL).length).toBe(1);

		peer.addRole(userRoles.NORMAL);

		expect(peer.roles.filter((r) => r === userRoles.NORMAL).length).toBe(1);
	});

	it('addRole() - add moderator', () => {
		spyEmit = jest.spyOn(peer, 'emit');

		expect(peer.roles.length).toBe(1);

		peer.addRole(userRoles.MODERATOR);

		expect(peer.roles.length).toBe(2);
		expect(peer.roles.filter((r) => r === userRoles.MODERATOR).length).toBe(1);
		expect(spyEmit).toHaveBeenCalledTimes(1);
	});

	it('removeRole() - remove moderator', () => {
		peer.addRole(userRoles.MODERATOR);
		expect(peer.roles.length).toBe(2);

		spyEmit = jest.spyOn(peer, 'emit');

		peer.removeRole(userRoles.MODERATOR);

		expect(peer.roles.length).toBe(1);
		expect(peer.roles.filter((r) => r === userRoles.MODERATOR).length).toBe(0);
		expect(spyEmit).toHaveBeenCalledTimes(1);
	});

	it('removeRole() - can\'t remove normal', () => {
		spyEmit = jest.spyOn(peer, 'emit');

		expect(peer.roles.length).toBe(1);

		peer.removeRole(userRoles.NORMAL);

		expect(peer.roles.length).toBe(1);
		expect(spyEmit).toHaveBeenCalledTimes(0);
	});

	describe('Router', () => {
		let router: Router;

		beforeEach(() => {
			router = {
				close: jest.fn(),
				once: jest.fn()
			} as unknown as Router;
		});

		it('getter should return undefined when no router', () => {
			expect(peer.router).toBe(undefined);
		});

		it('getter should return router when set', () => {
			peer.router = router;
			expect(peer.router).toEqual(router);
		});

		it('should not throw on undefined as argument', () => {
			expect(() => { peer.router = undefined; }).not.toThrow();
		});

		it('should set router to undefined on close event', () => {
			const emitRouter = new EventEmitter();

			peer.router = emitRouter as Router;
			expect(peer.router).toBe(emitRouter);
			emitRouter.emit('close');
		
			expect(peer.router).toBe(undefined);
		});
	});

	describe('Connections', () => {
		const DEBUG_MSG_ADD_CONNECTION = 'addConnection()';
		const REJECT_MESSAGE_SERVER_ERROR = 'Server error';
		let pipelineWithMiddleware: Pipeline<PeerContext>;
		let pipelineWithoutMiddleware: Pipeline<PeerContext>;
		let mockRequest: jest.SpyInstance; 
		let mockRespond: jest.SpyInstance;  
		let mockReject: jest.SpyInstance;  
		let spyPipelineExecute: jest.SpyInstance;
		let spyRequest: jest.SpyInstance;
		let mockSocketMessage: SocketMessage;
		
		beforeEach(() => {
			mockSocketMessage = {
			} as unknown as SocketMessage;
			pipelineWithoutMiddleware = {
				execute: (context: PeerContext) => {
					context.handled = false; 
				}
			} as unknown as Pipeline<PeerContext>;
			pipelineWithMiddleware = {
				execute: (context: PeerContext) => {
					context.handled = true; 
				}
			} as unknown as Pipeline<PeerContext>;
			mockRequest = jest.fn();
			mockRespond = jest.fn();
			mockReject = jest.fn();
			spyPipelineExecute = jest.spyOn(peer.pipeline, 'execute');
			spyRequest = jest.spyOn(connection, 'request');
		});

		afterEach(() => {
			jest.clearAllMocks();
		});

		it('addConnection() - should increment connection count', () => {
			const connection2 = new IOServerConnection(mockSocket);

			expect(peer.connections.items.length).toBe(1);

			peer.addConnection(connection2);

			expect(peer.connections.items.length).toBe(2);
		});

		it('addConnection() - handle close', () => {
			const spyClose = jest.spyOn(peer, 'close');

			expect(peer.connections.length).toBe(1);

			connection.close();

			expect(peer.connections.length).toBe(0);
			expect(spyClose).toHaveBeenCalled();
		});

		it('addConnection() - should execute pipeline on events', async () => {
			const mockNotification = jest.fn();

			await connection.emit('notification', mockNotification);
			
			expect(mockLoggerDebug).toHaveBeenCalledWith(DEBUG_MSG_ADD_CONNECTION);
			expect(spyPipelineExecute).toHaveBeenCalledTimes(1);
		});

		it('addConnection() - notification event: should throw and catch when not handled by middleware', async () => {
			peer.pipeline = pipelineWithoutMiddleware;

			await connection.emit('notification');
			expect(mockLoggerError).toHaveBeenCalledTimes(1);
		});
		
		it('addConnection() - notification event: should not throw and catch when handled by middleware', async () => {
			peer.pipeline = pipelineWithMiddleware;

			await connection.emit('notification');
			expect(mockLoggerError).not.toHaveBeenCalled();
		});
		
		it('addConnection() - request event: should not call reject when handled by middleware', async () => {
			peer.pipeline = pipelineWithMiddleware;

			await connection.emit('request', mockRequest, mockRespond, mockReject);

			expect(mockRespond).toHaveBeenCalledTimes(1);
			expect(mockReject).not.toHaveBeenCalled();
		});

		it('addConnection() - request event: should call reject when not handled by middleware', async () => {
			peer.pipeline = pipelineWithoutMiddleware;

			await connection.emit('request', mockRequest, mockRespond, mockReject);

			expect(mockReject).toHaveBeenNthCalledWith(1, REJECT_MESSAGE_SERVER_ERROR);
		});

		it('request() - should call request on connections', () => {
			peer.pipeline = pipelineWithoutMiddleware;
			peer.addConnection(connection);
			
			expect(spyRequest).not.toHaveBeenCalled();

			peer.request(mockSocketMessage);

			expect(spyRequest).toHaveBeenCalled();
		});
		
		it('request() - should log warn on no connections', () => {
			peer.pipeline = pipelineWithoutMiddleware;

			peer.connections.remove(connection);
			expect(peer.connections.length).toBe(0);
			
			peer.request(mockSocketMessage);

			expect(mockLoggerWarn).toHaveBeenCalled();
		});
	});
});