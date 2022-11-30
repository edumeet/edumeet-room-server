import { Pipeline } from 'edumeet-common';
import 'jest';
import MediaService from '../../src/MediaService';
import { Peer, PeerContext } from '../../src/Peer';
import Room from '../../src/Room';
import { Router } from '../../src/media/Router';


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
	let spyAddRoom: jest.SpyInstance;
	let spyRemoveRoom: jest.SpyInstance;
	const roomId1 = 'testRoom1';
	const roomId2 = 'testRoom2';
	const roomId3 = 'testRoom3';
	const roomName1 = 'testRoomName1';
	const roomName2 = 'testRoomName2';
	const roomName3 = 'testRoomName3';

	const router = {
		mediaNode: jest.fn(),
		connection: jest.fn(),
		id: jest.fn(),
		rtpCapabilities: jest.fn(),
		appData: {}
	} as unknown as Router


	beforeEach(() => {
		room1 = new Room({
			id: roomId1,
			mediaService: new MediaService(),
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
		spyAddRoom = jest.spyOn(room1.rooms, 'add')
		spyRemoveRoom = jest.spyOn(room1.rooms, 'remove')
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

	it('addPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const spyAllowPeer = jest.spyOn(Room.prototype as any, 'allowPeer');

		room1.addPeer(peer);
		expect(spyAllowPeer).toHaveBeenCalled();
	});

	it('allowPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const joinMiddleware = room1['joinMiddleware'];
		const initialMediaMiddleware = room1['initialMediaMiddleware'];
		const spyPipeline = jest.spyOn(peer.pipeline, 'use');
		const spyNotify = jest.spyOn(peer, 'notify');

		room1['allowPeer'](peer);

		expect(spyAddPendingPeer).toHaveBeenCalledWith(peer);

		expect(spyAddPeer).not.toHaveBeenCalled();
		expect(spyAddLobbyPeer).not.toHaveBeenCalled();

		expect(spyRemovePendingPeer).not.toHaveBeenCalled();
		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

		expect(room1.pendingPeers.length).toBe(1);
		expect(room1.pendingPeers.items[0]).toBe(peer);
		expect(room1.peers.length).toBe(0);
		expect(room1.lobbyPeers.length).toBe(0);

		expect(spyPipeline).toHaveBeenCalledWith(initialMediaMiddleware, joinMiddleware);
		expect(spyNotify).toHaveBeenCalled();
	});

	it('parkPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const lobbyPeerMiddleware = room1['lobbyPeerMiddleware'];
		const spyPipeline = jest.spyOn(peer.pipeline, 'use');
		const spyNotify = jest.spyOn(peer, 'notify');

		room1['parkPeer'](peer);
		expect(spyAddLobbyPeer).toHaveBeenCalledWith(peer);

		expect(spyAddPeer).not.toHaveBeenCalled();
		expect(spyAddPendingPeer).not.toHaveBeenCalled();

		expect(spyRemovePendingPeer).not.toHaveBeenCalled();
		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

		expect(room1.lobbyPeers.length).toBe(1);
		expect(room1.lobbyPeers.items[0]).toBe(peer);
		expect(room1.peers.length).toBe(0);
		expect(room1.pendingPeers.length).toBe(0);

		expect(spyPipeline).toHaveBeenCalledWith(lobbyPeerMiddleware);
		expect(spyNotify).toHaveBeenCalled();
	});

	it('joinPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const joinMiddleware = room1['joinMiddleware'];
		const peerMiddlewares = room1['peerMiddlewares'];

		const spyPipelineRemove = jest.spyOn(peer.pipeline, 'remove');
		const spyPipelineUse = jest.spyOn(peer.pipeline, 'use');

		room1['joinPeer'](peer);
		expect(spyAddPeer).toHaveBeenCalledWith(peer);
		expect(spyRemovePendingPeer).toHaveBeenCalled();

		expect(spyAddLobbyPeer).not.toHaveBeenCalled();
		expect(spyAddPendingPeer).not.toHaveBeenCalled();

		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

		expect(room1.peers.length).toBe(1);
		expect(room1.peers.items[0]).toBe(peer);
		expect(room1.lobbyPeers.length).toBe(0);
		expect(room1.pendingPeers.length).toBe(0);

		expect(spyPipelineRemove).toHaveBeenCalledWith(joinMiddleware);
		expect(spyPipelineUse).toHaveBeenCalledWith(...peerMiddlewares);
		expect(spyNotifyPeers).toHaveBeenCalledWith('newPeer', {
			...peer.peerInfo
		}, peer);
	});

	it('promotePeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const lobbyPeerMiddleware = room1['lobbyPeerMiddleware'];
		const spyAllowPeer = jest.spyOn(Room.prototype as any, 'allowPeer');
		const spyPipelineRemove = jest.spyOn(peer.pipeline, 'remove');

		room1['parkPeer'](peer);
		room1['promotePeer'](peer);

		expect(spyRemoveLobbyPeer).toHaveBeenCalled();
		
		expect(spyAddPeer).not.toHaveBeenCalled();
		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemovePendingPeer).not.toHaveBeenCalled();

		expect(room1.pendingPeers.length).toBe(1);
		expect(room1.pendingPeers.items[0]).toBe(peer);
		expect(room1.lobbyPeers.length).toBe(0);
		expect(room1.peers.length).toBe(0);

		expect(spyPipelineRemove).toHaveBeenCalledWith(lobbyPeerMiddleware);
		expect(spyAllowPeer).toHaveBeenCalled();
		expect(spyNotifyPeers).toHaveBeenCalledWith('lobby:promotedPeer', { peerId: peer.id }, peer);
	});

	it('removePeer() - pending peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		room1['allowPeer'](peer);
		room1.removePeer(peer);
		expect(room1.pendingPeers.length).toBe(0);
	});

	it('removePeer() - joined peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1.removePeer(peer);
		expect(room1.peers.length).toBe(0);
		expect(spyNotifyPeers).toHaveBeenCalledWith('peerClosed', { peerId: peer.id }, peer);
	});

	it('removePeer() - lobby peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		room1['parkPeer'](peer);
		room1.removePeer(peer);
		expect(room1.peers.length).toBe(0);
		expect(spyNotifyPeers).toHaveBeenCalledWith('lobby:peerClosed', { peerId: peer.id }, peer);
	});

	it('removePeer() - last peer leaves', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1.removePeer(peer);
		expect(room1.closed).toBe(true);
	});

	it('removePeer() - peer leaves, peer still there', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1['allowPeer'](peer);
		room1['allowPeer'](peer2);
		room1.removePeer(peer);
		expect(room1.closed).toBe(false);
		room1.removePeer(peer2);
		expect(room1.closed).toBe(true);
	});

	it('removePeer() - peer leaves, have pending peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const pendingPeer = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(pendingPeer);
		room1['allowPeer'](peer);
		room1.removePeer(peer);
		expect(room1.closed).toBe(false);
	});

	it('removePeer() - peer leaves, peer in lobby', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const lobbyPeer = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1['parkPeer'](lobbyPeer);
		room1.removePeer(peer);
		expect(room1.closed).toBe(false);
	});

	it('getPeers() - joined peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1.joinPeer(peer2);
		expect(room1.getPeers()).toEqual([ peer, peer2 ]);
	});

	it('getPeers() - exclude peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1.joinPeer(peer2);
		expect(room1.getPeers(peer)).toEqual([ peer2 ]);
	});

	it('getPeers() - lobby peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1['parkPeer'](peer2);
		expect(room1.getPeers()).toEqual([ peer ]);
	});

	it('getPeers() - pending peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1['allowPeer'](peer2);
		expect(room1.getPeers()).toEqual([ peer ]);
	});

	it('notifyPeers() - all peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1.joinPeer(peer2);

		const spyNotify1 = jest.spyOn(peer, 'notify');
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
		const peer = new Peer({
			id: 'test',
			roomId: roomId1,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId1,
		});

		room1.joinPeer(peer);
		room1.joinPeer(peer2);

		const spyNotify1 = jest.spyOn(peer, 'notify');
		const spyNotify2 = jest.spyOn(peer2, 'notify');

		room1.notifyPeers('test', { test: 'test' }, peer);

		expect(spyNotify1).not.toHaveBeenCalled();
		expect(spyNotify2).toHaveBeenCalledWith({
			method: 'test',
			data: { test: 'test' },
		});
	});
	
	it('addRouter() - should have one router', () => {
		expect(room1.routers.length).toBe(0)
		room1.addRouter(router);
		expect(room1.routers.length).toBe(1)
	})

	describe('Multiple rooms', () => {
	let room2: Room;
	let room3: Room

	beforeEach(() => {
		room2 = new Room({
			id: roomId2, 
			mediaService: new MediaService(), 
			name: roomName2,
		})
		room3 = new Room({
			id: roomId3, 
			mediaService: new MediaService(), 
			name: roomName3,
			parent: room2
		})
		
	})

	it('parentClosed - should return false on non-closed parent', () => {
		expect(room3.parentClosed).toBe(false)
	})

	it('parentClosed - should return true when parent is closed', () => {
		room2.close()
		expect(room3.parentClosed).toBe(true)
	})

	it('addRoom() - should have one room', () => {
		expect(room1.rooms.length).toBe(0)
		room1.addRoom(room2);
		expect(room1.rooms.length).toBe(1);
		})
	
		it('Should remove room when it closes', () => {
		room1.addRoom(room2)
		expect(spyRemoveRoom).not.toHaveBeenCalled()
		room2.close()
		expect(spyRemoveRoom).toHaveBeenCalled()
		})
	});
});