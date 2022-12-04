import { BaseConnection, IOServerConnection } from 'edumeet-common';
import 'jest';
import { Socket } from 'socket.io';
import { userRoles } from '../../src/common/authorization';
import { Peer } from '../../src/Peer';
import { Producer } from '../../src/media/Producer';
import { Consumer } from '../../src/media/Consumer';
import { WebRtcTransport } from '../../src/media/WebRtcTransport';

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

	it('addConnection()', () => {
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
});