import { BaseConnection, IOServerConnection } from 'edumeet-common';
import 'jest';
import { Socket } from 'socket.io';
import { Peer, PeerContext } from '../../src/Peer';
import { Producer } from '../../src/media/Producer';
import { Consumer } from '../../src/media/Consumer';
import { WebRtcTransport } from '../../src/media/WebRtcTransport';
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
		},
		handshake: {
			address: '127.0.0.1',
			headers: {
				'x-forwarded-for': '10.0.0.1'
			}
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
			sessionId: roomId,
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
		expect(peer.sessionId).toBe(roomId);
		expect(peer.connections.items[0]).toBe(connection);
		expect(peer.audioOnly).toBe(false);
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

	describe('Connections', () => {
		let pipelineWithMiddleware: Pipeline<PeerContext>;
		let pipelineWithoutMiddleware: Pipeline<PeerContext>;
		let mockRequest: jest.SpyInstance; 
		let mockRespond: jest.SpyInstance;  
		let mockReject: jest.SpyInstance;  
		let spyPipelineExecute: jest.SpyInstance;
		
		beforeEach(() => {
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

		it('addConnection() - should succesfully execute pipeline on handled notification', async () => {
			const mockNotification = jest.fn();

			connection.emit('notification', mockNotification);
			
			expect(spyPipelineExecute).toHaveBeenCalledTimes(1);
		});

		it('addConnection() - should not succesfully execute pipeline on unhandled notification', async () => {
			peer.pipeline = pipelineWithoutMiddleware;

			connection.emit('notification');
			expect(spyPipelineExecute).not.toHaveBeenCalled();
		});
		
		it('addConnection() - request promise should resolve when handled by middleware', async () => {
			peer.pipeline = pipelineWithMiddleware;

			connection.emit('request', mockRequest, mockRespond, mockReject);
			await new Promise(process.nextTick);
			expect(mockRespond).toHaveBeenCalledTimes(1);
			expect(mockReject).not.toHaveBeenCalled();
		});

		it('addConnection() - request promise should reject when not handled by middleware', async () => {
			peer.pipeline = pipelineWithoutMiddleware;

			connection.emit('request', mockRequest, mockRespond, mockReject);

			await new Promise(process.nextTick);
			expect(mockReject).toHaveBeenCalledTimes(1);
			expect(mockRespond).not.toHaveBeenCalled();
		});
	});
});