import 'jest';
import { IOServerConnection } from 'edumeet-common';
import MediaService from '../../src/MediaService';
import ServerManager from '../../src/ServerManager';
import { Socket } from 'socket.io';
import LoadBalancer from '../../src/loadbalancing/LoadBalancer';
import { Config } from '../../src/Config';

describe('ServerManager', () => {
	let serverManager: ServerManager;
	const config = { mediaNodes: [] } as unknown as Config;
	const loadBalancer = {} as unknown as LoadBalancer;

	beforeEach(() => {
		serverManager = new ServerManager({
			mediaService: new MediaService({ loadBalancer, config }) 
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(serverManager).toBeInstanceOf(ServerManager);
		expect(serverManager.mediaService).toBeDefined();
		expect(serverManager.mediaService).toBeInstanceOf(MediaService);
		expect(serverManager.peers).toBeDefined();
		expect(serverManager.peers).toBeInstanceOf(Map);
		expect(serverManager.peers.size).toBe(0);
		expect(serverManager.rooms).toBeDefined();
		expect(serverManager.rooms).toBeInstanceOf(Map);
		expect(serverManager.rooms.size).toBe(0);
		expect(serverManager.closed).toBe(false);
	});

	it('close()', () => {
		serverManager.close();
		expect(serverManager.closed).toBe(true);
		expect(serverManager.mediaService.closed).toBe(true);
		expect(serverManager.peers.size).toBe(0);
		expect(serverManager.rooms.size).toBe(0);

		const spy = jest.spyOn(serverManager.mediaService, 'close');

		serverManager.close();
		expect(spy).not.toHaveBeenCalled();
	});

	describe('handleConnection()', () => {
		let connection1: IOServerConnection;
		let connection2: IOServerConnection;
		let connection3: IOServerConnection;
		let spyConnectionClose: jest.SpyInstance;
		const roomId1 = 'testRoom1';
		const roomId2 = 'testRoom2';
		const peerId1 = 'testPeer1';
		const peerId2 = 'testPeer2';
		const peerId3 = 'testPeer3';
		const displayName = 'testDisplayName';

		beforeEach(() => {
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
	
			connection1 = new IOServerConnection(mockSocket);
			connection2 = new IOServerConnection(mockSocket);
			connection3 = new IOServerConnection(mockSocket);
			serverManager.handleConnection(connection1, peerId1, roomId1, displayName);
		});

		it('first peer joins', () => {
			expect(serverManager.peers.size).toBe(1);
			expect(serverManager.rooms.size).toBe(1);
			expect(serverManager.rooms.get(roomId1)).toBeDefined();
			expect(serverManager.peers.get(peerId1)).toBeDefined();
			expect(serverManager.peers.get(peerId1)?.roomId).toBe(roomId1);
		});

		it('first peer tries to join different room', () => {
			const peer = serverManager.peers.get(peerId1);

			if (!peer) {
				throw new Error('Peer was undefined');
			}

			const peerToken = peer.token;

			serverManager.handleConnection(
				connection1, 
				peerId1, 
				roomId2, 
				displayName, 
				peerToken
			);
			expect(serverManager.peers.size).toBe(1);
			expect(serverManager.rooms.size).toBe(1);
			expect(serverManager.rooms.get(roomId1)).toBeUndefined();
			expect(serverManager.rooms.get(roomId2)).toBeDefined();
			expect(serverManager.peers.get(peerId1)).toBeDefined();
			expect(serverManager.peers.get(peerId1)?.roomId).toBe(roomId2);
		});

		it('peer with invalid token', () => {
			// Try to join with a second peer with the same peerId but no token should throw
			try {
				serverManager.handleConnection(connection1, peerId1, roomId1);
			} catch (error) {
				expect((error as Error).message).toBe('Invalid token');
			}
		});

		it('peer with invalid token', () => {
			// Try to join with a second peer with the same peerId but wrong token should throw
			try {
				serverManager.handleConnection(connection1, peerId1, roomId1, displayName, 'wrongToken');
			} catch (error) {
				expect((error as Error).message).toBe('Invalid token');
			}
		});

		it('peer with valid token', () => {
			const peer = serverManager.peers.get(peerId1);

			if (!peer) {
				throw new Error('Peer was undefined');
			}
			const spyClose: jest.SpyInstance = jest.spyOn(peer, 'close');

			spyConnectionClose = jest.spyOn(connection1, 'close');
			const peerToken = peer.token;
	
			/**
			 * Try to join with a second peer
			 * Same peerId and correct token should work
			 * Should end up with one peer in one room
			 */
			serverManager.handleConnection(
				connection1, 
				peerId1, 
				roomId1, 
				displayName, 
				peerToken
			);
			expect(spyClose).toHaveBeenCalled();
			expect(spyConnectionClose).toHaveBeenCalled();
			expect(serverManager.peers.size).toBe(1);
			expect(serverManager.rooms.size).toBe(1);
			expect(serverManager.rooms.get(roomId1)).toBeDefined();
			expect(serverManager.peers.get(peerId1)).toBeDefined();
			expect(serverManager.peers.get(peerId1)?.roomId).toBe(roomId1);
		}); 
		
		it('should close peer connections when closing servermanager', () => {
			const peer1 = serverManager.peers.get(peerId1);

			expect(peer1).toBeTruthy();
			if (peer1) {
				const spyClose: jest.SpyInstance = jest.spyOn(peer1, 'close');

				serverManager.close();
				expect(spyClose).toHaveBeenCalled();
			}
		});
		
		describe('second peer', () => {
			beforeEach(() => {
				// Second client joins, should end up with two peers in one room
				serverManager.handleConnection(connection2, peerId2, roomId1, displayName);
			});

			it('second peer joins', () => {
				/**
				 * Try to join with a second peer
				 * A different peerId and no token should work
				 * Should end up with two peers in one room
				 */
				expect(serverManager.peers.size).toBe(2);
				expect(serverManager.rooms.size).toBe(1);
				expect(serverManager.rooms.get(roomId1)).toBeDefined();
				expect(serverManager.peers.get(peerId2)).toBeDefined();
				expect(serverManager.peers.get(peerId2)?.roomId).toBe(roomId1);
			});
	
			it('third peer joins different room and everyone leaves', () => {
				// Try to join with a third peer with a different peerId and no token should work,
				// and should end up with three peers in two rooms
				serverManager.handleConnection(connection3, peerId3, roomId2, displayName);
				expect(serverManager.peers.size).toBe(3);
				expect(serverManager.rooms.size).toBe(2);
				expect(serverManager.rooms.get(roomId2)).toBeDefined();
				expect(serverManager.peers.get(peerId3)).toBeDefined();
				expect(serverManager.peers.get(peerId3)?.roomId).toBe(roomId2);
		
				const peer1 = serverManager.peers.get(peerId1);
				const peer2 = serverManager.peers.get(peerId2);
				const peer3 = serverManager.peers.get(peerId3);
				
				if (!peer1 || !peer2 || !peer3) {
					throw new Error('Peer was undefined');
				}
		
				/**
				 * One of the peers in the first room leaves
				 * Should end up with two peers in two rooms
				 */
				peer1.close();
		
				expect(serverManager.peers.size).toBe(2);
				expect(serverManager.rooms.size).toBe(2);
		
				// Second peer in first room leaves, should end up with one peer in one room
				peer2.close();
		
				expect(serverManager.peers.size).toBe(1);
				expect(serverManager.rooms.size).toBe(1);
		
				// Third peer in second room leaves, should end up with no peers in no rooms
				peer3.close();
		
				expect(serverManager.peers.size).toBe(0);
				expect(serverManager.rooms.size).toBe(0);
			});
		});
	});
});