import 'jest';
import MediaService from '../../src/MediaService';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';
import { Router } from '../../src/media/Router';
import { userRoles } from '../../src/common/authorization';
import LoadBalancer from '../../src/loadbalancing/LoadBalancer';
import { Config } from '../../src/Config';

describe('Room', () => {
	let room1: Room;
	let spyEmit: jest.SpyInstance;
	let spyNotifyPeers: jest.SpyInstance;
	let spyAddPeer: jest.SpyInstance;
	let spyRemovePeer: jest.SpyInstance;
	let spyAddPendingPeer: jest.SpyInstance;
	let spyRemovePendingPeer: jest.SpyInstance;
	let spyAddLobbyPeer: jest.SpyInstance;
	let spyRemoveLobbyPeer: jest.SpyInstance;
	let spyRemoveRoom: jest.SpyInstance;
	const roomId1 = 'testRoom1';
	const roomId2 = 'testRoom2';
	const roomId3 = 'testRoom3';
	const roomName1 = 'testRoomName1';
	const roomName2 = 'testRoomName2';
	const roomName3 = 'testRoomName3';
	const config = { mediaNodes: [] } as unknown as Config;
	const loadBalancer = {} as unknown as LoadBalancer;	

	beforeEach(() => {
		
		room1 = new Room({
			id: roomId1,
			mediaService: new MediaService({ loadBalancer, config }),
			name: roomName1,
		});

		spyEmit = jest.spyOn(room1, 'emit');
		spyNotifyPeers = jest.spyOn(room1, 'notifyPeers');
		spyAddPeer = jest.spyOn(room1.peers, 'add');
		spyRemovePeer = jest.spyOn(room1.peers, 'remove');
		spyAddPendingPeer = jest.spyOn(room1.pendingPeers, 'add');
		spyRemovePendingPeer = jest.spyOn(room1.pendingPeers, 'remove');
		spyAddLobbyPeer = jest.spyOn(room1.lobbyPeers, 'add');
		spyRemoveLobbyPeer = jest.spyOn(room1.lobbyPeers, 'remove');

		spyRemoveRoom = jest.spyOn(room1.rooms, 'remove');
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
				mediaNode: jest.fn(),
				connection: jest.fn(),
				id: jest.fn(),
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

		it('pushRouter() - should not add same router twice', () => {
			room1.addRouter(router);
			room1['pushRouter'](router);
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

		it('close() - remove pending peer', () => {
			room1.addPeer(peer1);
			const spyClose = jest.spyOn(peer1, 'close');

			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('close() - remove peer', () => {
			room1['joinPeer'](peer1);
			const spyClose = jest.spyOn(peer1, 'close');

			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('close() - remove lobbyPeer', () => {
			room1['parkPeer'](peer1);
			const spyClose = jest.spyOn(peer1, 'close');

			room1.close();
			expect(spyClose).toHaveBeenCalled();
		});

		it('addPeer()', () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const spyAllowPeer = jest.spyOn(Room.prototype as any, 'allowPeer');

			room1.addPeer(peer1);

			expect(spyAllowPeer).toHaveBeenCalled();
		});

		it('addPeer() - room locked', () => {
			room1.locked = true;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const spyParkPeer = jest.spyOn(Room.prototype as any, 'parkPeer');

			room1.addPeer(peer1);
			expect(spyParkPeer).toHaveBeenCalled();
		});

		it('addPeer() - room locked, promote peer to admin', () => {
			room1.locked = true;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const spyPromotePeer = jest.spyOn(Room.prototype as any, 'promotePeer');

			room1.addPeer(peer1);
			peer1.addRole(userRoles.ADMIN);

			expect(spyPromotePeer).toHaveBeenCalled();
		});

		it('allowPeer()', () => {

			const joinMiddleware = room1['joinMiddleware'];
			const initialMediaMiddleware = room1['initialMediaMiddleware'];
			const spyPipeline = jest.spyOn(peer1.pipeline, 'use');
			const spyNotify = jest.spyOn(peer1, 'notify');

			room1['allowPeer'](peer1);

			expect(spyAddPendingPeer).toHaveBeenCalledWith(peer1);

			expect(spyAddPeer).not.toHaveBeenCalled();
			expect(spyAddLobbyPeer).not.toHaveBeenCalled();

			expect(spyRemovePendingPeer).not.toHaveBeenCalled();
			expect(spyRemovePeer).not.toHaveBeenCalled();
			expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

			expect(room1.pendingPeers.length).toBe(1);
			expect(room1.pendingPeers.items[0]).toBe(peer1);
			expect(room1.peers.length).toBe(0);
			expect(room1.lobbyPeers.length).toBe(0);

			expect(spyPipeline).toHaveBeenCalledWith(initialMediaMiddleware, joinMiddleware);
			expect(spyNotify).toHaveBeenCalled();
		});

		it('parkPeer()', () => {
			const lobbyPeerMiddleware = room1['lobbyPeerMiddleware'];
			const spyPipeline = jest.spyOn(peer1.pipeline, 'use');
			const spyNotify = jest.spyOn(peer1, 'notify');

			room1['parkPeer'](peer1);
			expect(spyAddLobbyPeer).toHaveBeenCalledWith(peer1);

			expect(spyAddPeer).not.toHaveBeenCalled();
			expect(spyAddPendingPeer).not.toHaveBeenCalled();

			expect(spyRemovePendingPeer).not.toHaveBeenCalled();
			expect(spyRemovePeer).not.toHaveBeenCalled();
			expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

			expect(room1.lobbyPeers.length).toBe(1);
			expect(room1.lobbyPeers.items[0]).toBe(peer1);
			expect(room1.peers.length).toBe(0);
			expect(room1.pendingPeers.length).toBe(0);

			expect(spyPipeline).toHaveBeenCalledWith(lobbyPeerMiddleware);
			expect(spyNotify).toHaveBeenCalled();
		});

		it('joinPeer()', () => {
			const joinMiddleware = room1['joinMiddleware'];
			const peerMiddlewares = room1['peerMiddlewares'];

			const spyPipelineRemove = jest.spyOn(peer1.pipeline, 'remove');
			const spyPipelineUse = jest.spyOn(peer1.pipeline, 'use');

			room1['joinPeer'](peer1);
			expect(spyAddPeer).toHaveBeenCalledWith(peer1);
			expect(spyRemovePendingPeer).toHaveBeenCalled();

			expect(spyAddLobbyPeer).not.toHaveBeenCalled();
			expect(spyAddPendingPeer).not.toHaveBeenCalled();

			expect(spyRemovePeer).not.toHaveBeenCalled();
			expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

			expect(room1.peers.length).toBe(1);
			expect(room1.peers.items[0]).toBe(peer1);
			expect(room1.lobbyPeers.length).toBe(0);
			expect(room1.pendingPeers.length).toBe(0);

			expect(spyPipelineRemove).toHaveBeenCalledWith(joinMiddleware);
			expect(spyPipelineUse).toHaveBeenCalledWith(...peerMiddlewares);
			expect(spyNotifyPeers).toHaveBeenCalledWith('newPeer', {
				...peer1.peerInfo
			}, peer1);
		});

		it('promotePeer()', () => {
			const lobbyPeerMiddleware = room1['lobbyPeerMiddleware'];
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const spyAllowPeer = jest.spyOn(Room.prototype as any, 'allowPeer');
			const spyPipelineRemove = jest.spyOn(peer1.pipeline, 'remove');

			room1['parkPeer'](peer1);
			room1['promotePeer'](peer1);

			expect(spyRemoveLobbyPeer).toHaveBeenCalled();

			expect(spyAddPeer).not.toHaveBeenCalled();
			expect(spyRemovePeer).not.toHaveBeenCalled();
			expect(spyRemovePendingPeer).not.toHaveBeenCalled();

			expect(room1.pendingPeers.length).toBe(1);
			expect(room1.pendingPeers.items[0]).toBe(peer1);
			expect(room1.lobbyPeers.length).toBe(0);
			expect(room1.peers.length).toBe(0);

			expect(spyPipelineRemove).toHaveBeenCalledWith(lobbyPeerMiddleware);
			expect(spyAllowPeer).toHaveBeenCalled();
			expect(spyNotifyPeers).toHaveBeenCalledWith('lobby:promotedPeer', { peerId: peer1.id }, peer1);
		});

		it('promoteAllPeers()', () => {
			room1['parkPeer'](peer1);
			room1.joinPeer(peer2);

			expect(room1.lobbyPeers.length).toBe(1);
			expect(room1.peers.length).toBe(1);
			room1.promoteAllPeers();

			expect(room1.pendingPeers.length).toBe(1);
		});

		it('removePeer() - pending peer', () => {
			room1['allowPeer'](peer1);
			room1.removePeer(peer1);
			expect(room1.pendingPeers.length).toBe(0);
		});

		it('removePeer() - joined peer', () => {
			room1.joinPeer(peer1);
			room1.removePeer(peer1);
			expect(room1.peers.length).toBe(0);
			expect(spyNotifyPeers).toHaveBeenCalledWith('peerClosed', { peerId: peer1.id }, peer1);
		});

		it('removePeer() - lobby peer', () => {
			room1['parkPeer'](peer1);
			room1.removePeer(peer1);
			expect(room1.peers.length).toBe(0);
			expect(spyNotifyPeers).toHaveBeenCalledWith('lobby:peerClosed', { peerId: peer1.id }, peer1);
		});

		it('removePeer() - last peer leaves', () => {
			room1.joinPeer(peer1);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(true);
		});

		it('removePeer() - peer leaves, peer still there', () => {

			room1['allowPeer'](peer1);
			room1['allowPeer'](peer2);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(false);
			room1.removePeer(peer2);
			expect(room1.closed).toBe(true);
		});

		it('removePeer() - peer leaves, have pending peer', () => {
			const pendingPeer = new Peer({
				id: 'test2',
				roomId: roomId1,
			});

			room1.joinPeer(pendingPeer);
			room1['allowPeer'](peer1);
			room1.removePeer(peer1);
			expect(room1.closed).toBe(false);
		});

		it('removePeer() - peer leaves, peer in lobby', () => {
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
			room1['parkPeer'](lobbyPeer);
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

		it('getPeers() - lobby peers', () => {
			room1.joinPeer(peer1);
			room1['parkPeer'](peer2);
			expect(room1.getPeers()).toEqual([ peer1 ]);
		});

		it('getPeers() - pending peers', () => {
			room1.joinPeer(peer1);
			room1['allowPeer'](peer2);
			expect(room1.getPeers()).toEqual([ peer1 ]);
		});

		it('notifyPeers() - all peers', () => {
			room1.joinPeer(peer1);
			room1.joinPeer(peer2);

			const spyNotify1 = jest.spyOn(peer1, 'notify');
			const spyNotify2 = jest.spyOn(peer2, 'notify');

			expect(room1.peers.length).toBe(2);

			room1.notifyPeers('test', { test: 'test' });

			expect(spyNotify1).toHaveBeenCalledWith({
				method: 'test',
				data: { test: 'test' },
			});
			expect(spyNotify2).toHaveBeenCalledWith({
				method: 'test',
				data: { test: 'test' },
			});
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
			room2 = new Room({
				id: roomId2,
				mediaService: new MediaService({ loadBalancer, config }),
				name: roomName2,
			});
			room3 = new Room({
				id: roomId3,
				mediaService: new MediaService({ loadBalancer, config }),
				name: roomName3,
				parent: room2
			});

		});

		it('parentClosed - should return false on non-closed parent', () => {
			expect(room3.parentClosed).toBe(false);
		});

		it('parentClosed - should return true when parent is closed', () => {
			room2.close();
			expect(room3.parentClosed).toBe(true);
		});

		it('addRoom() - should have one room', () => {
			expect(room1.rooms.length).toBe(0);
			room1.addRoom(room2);
			expect(room1.rooms.length).toBe(1);
		});

		it('close() - Parent Should remove child room when it calls close()', () => {
			room1.addRoom(room2);
			room2.close();

			expect(spyRemoveRoom).toHaveBeenCalled();
		});
	});
});