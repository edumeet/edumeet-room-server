import 'jest';
import MediaService from '../../src/MediaService';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';
import { Router } from '../../src/media/Router';
import { userRoles } from '../../src/common/authorization';
import LoadBalancer from '../../src/LoadBalancer';
import { Config } from '../../src/Config';
import { KDTree } from 'edumeet-common';

describe('Room', () => {
	let room1: Room;
	let spyEmit: jest.SpyInstance;
	let spyNotifyPeers: jest.SpyInstance;
	const roomId1 = 'testRoom1';
	const roomId2 = 'testRoom2';
	const roomId3 = 'testRoom3';
	const roomName1 = 'testRoomName1';
	const roomName2 = 'testRoomName2';
	const roomName3 = 'testRoomName3';
	const config = { mediaNodes: [] } as unknown as Config;
	const loadBalancer = {} as unknown as LoadBalancer;	
	const mediaNodeId = 'mediaNodeId';

	beforeEach(() => {
		const kdTree = { rebalance: jest.fn() } as unknown as KDTree;
		const mediaService = MediaService.create(loadBalancer, kdTree, config);

		room1 = new Room({
			id: roomId1,
			mediaService, 
			name: roomName1,
		});

		spyEmit = jest.spyOn(room1, 'emit');
		spyNotifyPeers = jest.spyOn(room1, 'notifyPeers');
	});

	it('Has correct properties', () => {
		expect(room1).toBeInstanceOf(Room);
		expect(room1.id).toBe(roomId1);
		expect(room1.name).toBe(roomName1);
		expect(room1.sessionId).toBeDefined();
		expect(room1.closed).toBe(false);
		expect(room1.locked).toBe(false);

		expect(room1.routers.length).toBe(0);
		expect(room1.rooms.length).toBe(0);
		expect(room1.pendingPeers.length).toBe(0);
		expect(room1.peers.length).toBe(0);
		expect(room1.lobbyPeers.length).toBe(0);
	});

	it('close()', () => {
		room1.close();
		expect(room1.closed).toBe(true);
		expect(spyEmit).toHaveBeenCalledTimes(1);
	});

	describe('Router', () => {
		let router: Router;
		let spyClose: jest.SpyInstance;
		let spyAdd: jest.SpyInstance;

		beforeEach(() => {
			router = {
				mediaNode: {
					id: mediaNodeId 
				},
				connection: jest.fn(),
				id: 'routerId',
				rtpCapabilities: jest.fn(),
				appData: {},
				close: jest.fn()
			} as unknown as Router;
			spyClose = jest.spyOn(router, 'close');
			spyAdd = jest.spyOn(room1.routers, 'add');
		});

		it('close() - should close router', () => {
			room1.addRouter(router);
			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('addRouter() - should have one router', () => {
			expect(room1.routers.length).toBe(0);
			room1.addRouter(router);
			expect(room1.routers.length).toBe(1);
			expect(spyAdd).toHaveBeenCalled();
		});
		
		it('addRouter() - should have one active mediaNode', () => {
			room1.addRouter(router);
			const result = room1.getActiveMediaNodes();

			expect(result.length).toBe(1);
			expect(result[0].id).toBe(mediaNodeId);
		});

		it('pushRouter() - should not add same router twice', () => {
			room1.addRouter(router);
			room1.addRouter(router);
			expect(spyAdd.mock.calls.length).toBe(1);
		});
	});

	describe('Peers', () => {
		let peer1: Peer;
		let peer2: Peer;

		beforeEach(() => {
			peer1 = new Peer({
				id: 'test',
				roomId: roomId1,
			});
			peer2 = new Peer({
				id: 'test2',
				roomId: roomId1,
			});
		});

		it('close() - should remove pending peer', () => {
			room1.addPeer(peer1);
			const spyClose = jest.spyOn(peer1, 'close');

			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('close() - should remove peer', () => {
			room1.joinPeer(peer1);
			const spyClose = jest.spyOn(peer1, 'close');

			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('close() - should remove lobbyPeer', () => {
			room1.locked = true;
			room1.addPeer(peer1);
			expect(room1.lobbyPeers.length).toBe(1);
			const spyClose = jest.spyOn(peer1, 'close');

			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('addPeer() - room locked, should promote peer to admin', () => {
			room1.locked = true;
			const spyPromotePeer = jest.spyOn(room1, 'promotePeer');

			room1.addPeer(peer1);
			peer1.addRole(userRoles.ADMIN);
			expect(spyPromotePeer).toHaveBeenCalled();
		});

		it('joinPeer()', () => {
			room1.joinPeer(peer1);

			expect(room1.peers.length).toBe(1);
			expect(room1.peers.items[0]).toBe(peer1);
			expect(room1.lobbyPeers.length).toBe(0);
			expect(room1.pendingPeers.length).toBe(0);

			expect(spyNotifyPeers).toHaveBeenCalledTimes(1);
		});

		it('promoteAllPeers() should move peer to pendingPeers', () => {
			room1.lobbyPeers.add(peer2);

			expect(room1.lobbyPeers.length).toBe(1);
			expect(room1.peers.length).toBe(0);
			room1.promoteAllPeers();

			expect(room1.pendingPeers.length).toBe(1);
			expect(room1.peers.length).toBe(0);
		});

		it('removePeer() - joined peer', () => {
			room1.joinPeer(peer1);
			expect(room1.peers.length).toBe(1);
			room1.removePeer(peer1);
			expect(room1.peers.length).toBe(0);
		});

		it('removePeer() - lobby peer', () => {
			room1.locked = true;
			room1.addPeer(peer1);
			expect(room1.lobbyPeers.length).toBe(1);
			room1.removePeer(peer1);
			expect(room1.peers.length).toBe(0);
		});

		it('removePeer() - last peer leaves', () => {
			room1.joinPeer(peer1);
			expect(room1.closed).toBe(false);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(true);
		});

		it('removePeer() - room should not close on pending peer', () => {
			const pendingPeer = new Peer({
				id: 'test2',
				roomId: roomId1,
			});

			room1.joinPeer(peer1);
			room1.addPeer(pendingPeer);
			expect(room1.pendingPeers.length).toBe(1);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(false);
		});

		it('removePeer() - eer leaves, peer in lobby', () => {
			const lobbyPeer = new Peer({
				id: 'test2',
				roomId: roomId1,
			});

			room1.joinPeer(peer1);
			room1['parkPeer'](lobbyPeer);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(false);
		});

		it('removePeer() - peer leaves, peer in lobby', () => {
			const lobbyPeer = new Peer({
				id: 'test2',
				roomId: roomId1,
			});

			room1.joinPeer(peer1);
			room1.addPeer(lobbyPeer);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(false);
		});

		it('getPeers() - joined peers', () => {
			room1.joinPeer(peer1);
			room1.joinPeer(peer2);
			expect(room1.getPeers()).toEqual([ peer1, peer2 ]);
		});

		it('getPeers() - exclude peer', () => {

			room1.joinPeer(peer1);
			room1.joinPeer(peer2);
			expect(room1.getPeers(peer1)).toEqual([ peer2 ]);
		});

		it('getPeers() - getPeers should exlude lobbypeers', () => {
			room1.locked = true;
			room1.joinPeer(peer1);
			room1.addPeer(peer2);
			expect(room1.getPeers()).toEqual([ peer1 ]);
		});

		it('notifyPeers() - all peers', () => {
			room1.joinPeer(peer1);
			room1.joinPeer(peer2);

			const spyNotify1 = jest.spyOn(peer1, 'notify');
			const spyNotify2 = jest.spyOn(peer2, 'notify');

			expect(room1.peers.length).toBe(2);

			room1.notifyPeers('test', { test: 'test' });

			expect(spyNotify1).toHaveBeenCalledTimes(1);
			expect(spyNotify2).toHaveBeenCalledTimes(1);
		});

		it('notifyPeers() - exclude peer', () => {
			room1.joinPeer(peer1);
			room1.joinPeer(peer2);

			const spyNotify1 = jest.spyOn(peer1, 'notify');
			const spyNotify2 = jest.spyOn(peer2, 'notify');

			room1.notifyPeers('test', { test: 'test' }, peer1);

			expect(spyNotify1).not.toHaveBeenCalled();
			expect(spyNotify2).toHaveBeenCalledWith({
				method: 'test',
				data: { test: 'test' },
			});
		});
	});

	describe('Multiple rooms', () => {
		let room2: Room;
		let room3: Room;

		beforeEach(() => {
			const kdTree = { rebalance: jest.fn() } as unknown as KDTree;	
			const mediaService = MediaService.create(loadBalancer, kdTree, config);

			room2 = new Room({
				id: roomId2,
				mediaService, 
				name: roomName2,
			});
			room3 = new Room({
				id: roomId3,
				mediaService,
				name: roomName3,
				parent: room2
			});

		});

		it('parentClosed - child should know when parent is closed', () => {
			expect(room3.parentClosed).toBe(false);
			room2.close();
			expect(room3.parentClosed).toBe(true);
		});

		it('close() - Parent Should remove child room when it calls close()', () => {
			room1.addRoom(room2);
			expect(room1.rooms.has(room2)).toBe(true);
			room2.close();
			expect(room1.rooms.has(room2)).toBe(false);
		});
	});
});