import 'jest';
import MediaService from '../../src/MediaService';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';

describe('Room', () => {
	let room: Room;
	let spyEmit: jest.SpyInstance;
	let spyNotifyPeers: jest.SpyInstance;
	let spyAddPeer: jest.SpyInstance;
	let spyRemovePeer: jest.SpyInstance;
	let spyAddPendingPeer: jest.SpyInstance;
	let spyRemovePendingPeer: jest.SpyInstance;
	let spyAddLobbyPeer: jest.SpyInstance;
	let spyRemoveLobbyPeer: jest.SpyInstance;
	const roomId = 'testRoom';
	const roomName = 'testRoomName';

	beforeEach(() => {
		room = new Room({
			id: roomId,
			mediaService: new MediaService(),
			name: roomName,
		});

		spyEmit = jest.spyOn(room, 'emit');
		spyNotifyPeers = jest.spyOn(room, 'notifyPeers');
		spyAddPeer = jest.spyOn(room.peers, 'add');
		spyRemovePeer = jest.spyOn(room.peers, 'remove');
		spyAddPendingPeer = jest.spyOn(room.pendingPeers, 'add');
		spyRemovePendingPeer = jest.spyOn(room.pendingPeers, 'remove');
		spyAddLobbyPeer = jest.spyOn(room.lobbyPeers, 'add');
		spyRemoveLobbyPeer = jest.spyOn(room.lobbyPeers, 'remove');
	});

	it('Has correct properties', () => {
		expect(room).toBeInstanceOf(Room);
		expect(room.id).toBe(roomId);
		expect(room.name).toBe(roomName);
		expect(room.sessionId).toBeDefined();
		expect(room.closed).toBe(false);
		expect(room.locked).toBe(false);

		expect(room.routers.length).toBe(0);
		expect(room.rooms.length).toBe(0);
		expect(room.pendingPeers.length).toBe(0);
		expect(room.peers.length).toBe(0);
		expect(room.lobbyPeers.length).toBe(0);
	});

	it('close()', () => {
		room.close();
		expect(room.closed).toBe(true);
		expect(spyEmit).toHaveBeenCalledTimes(1);
	});

	it('addPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const spyAllowPeer = jest.spyOn(Room.prototype as any, 'allowPeer');

		room.addPeer(peer);
		expect(spyAllowPeer).toHaveBeenCalled();
	});

	it('allowPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const joinMiddleware = room['joinMiddleware'];
		const initialMediaMiddleware = room['initialMediaMiddleware'];
		const spyPipeline = jest.spyOn(peer.pipeline, 'use');
		const spyNotify = jest.spyOn(peer, 'notify');

		room['allowPeer'](peer);

		expect(spyAddPendingPeer).toHaveBeenCalledWith(peer);

		expect(spyAddPeer).not.toHaveBeenCalled();
		expect(spyAddLobbyPeer).not.toHaveBeenCalled();

		expect(spyRemovePendingPeer).not.toHaveBeenCalled();
		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

		expect(room.pendingPeers.length).toBe(1);
		expect(room.pendingPeers.items[0]).toBe(peer);
		expect(room.peers.length).toBe(0);
		expect(room.lobbyPeers.length).toBe(0);

		expect(spyPipeline).toHaveBeenCalledWith(initialMediaMiddleware, joinMiddleware);
		expect(spyNotify).toHaveBeenCalled();
	});

	it('parkPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const lobbyPeerMiddleware = room['lobbyPeerMiddleware'];
		const spyPipeline = jest.spyOn(peer.pipeline, 'use');
		const spyNotify = jest.spyOn(peer, 'notify');

		room['parkPeer'](peer);
		expect(spyAddLobbyPeer).toHaveBeenCalledWith(peer);

		expect(spyAddPeer).not.toHaveBeenCalled();
		expect(spyAddPendingPeer).not.toHaveBeenCalled();

		expect(spyRemovePendingPeer).not.toHaveBeenCalled();
		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

		expect(room.lobbyPeers.length).toBe(1);
		expect(room.lobbyPeers.items[0]).toBe(peer);
		expect(room.peers.length).toBe(0);
		expect(room.pendingPeers.length).toBe(0);

		expect(spyPipeline).toHaveBeenCalledWith(lobbyPeerMiddleware);
		expect(spyNotify).toHaveBeenCalled();
	});

	it('joinPeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const joinMiddleware = room['joinMiddleware'];
		const peerMiddlewares = room['peerMiddlewares'];

		const spyPipelineRemove = jest.spyOn(peer.pipeline, 'remove');
		const spyPipelineUse = jest.spyOn(peer.pipeline, 'use');

		room['joinPeer'](peer);
		expect(spyAddPeer).toHaveBeenCalledWith(peer);
		expect(spyRemovePendingPeer).toHaveBeenCalled();

		expect(spyAddLobbyPeer).not.toHaveBeenCalled();
		expect(spyAddPendingPeer).not.toHaveBeenCalled();

		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemoveLobbyPeer).not.toHaveBeenCalled();

		expect(room.peers.length).toBe(1);
		expect(room.peers.items[0]).toBe(peer);
		expect(room.lobbyPeers.length).toBe(0);
		expect(room.pendingPeers.length).toBe(0);

		expect(spyPipelineRemove).toHaveBeenCalledWith(joinMiddleware);
		expect(spyPipelineUse).toHaveBeenCalledWith(...peerMiddlewares);
		expect(spyNotifyPeers).toHaveBeenCalledWith('newPeer', {
			...peer.peerInfo
		}, peer);
	});

	it('promotePeer()', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const lobbyPeerMiddleware = room['lobbyPeerMiddleware'];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const spyAllowPeer = jest.spyOn(Room.prototype as any, 'allowPeer');
		const spyPipelineRemove = jest.spyOn(peer.pipeline, 'remove');

		room['parkPeer'](peer);
		room['promotePeer'](peer);

		expect(spyRemoveLobbyPeer).toHaveBeenCalled();
		
		expect(spyAddPeer).not.toHaveBeenCalled();
		expect(spyRemovePeer).not.toHaveBeenCalled();
		expect(spyRemovePendingPeer).not.toHaveBeenCalled();

		expect(room.pendingPeers.length).toBe(1);
		expect(room.pendingPeers.items[0]).toBe(peer);
		expect(room.lobbyPeers.length).toBe(0);
		expect(room.peers.length).toBe(0);

		expect(spyPipelineRemove).toHaveBeenCalledWith(lobbyPeerMiddleware);
		expect(spyAllowPeer).toHaveBeenCalled();
		expect(spyNotifyPeers).toHaveBeenCalledWith('lobby:promotedPeer', { peerId: peer.id }, peer);
	});

	it('removePeer() - pending peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		room['allowPeer'](peer);
		room.removePeer(peer);
		expect(room.pendingPeers.length).toBe(0);
	});

	it('removePeer() - joined peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room.removePeer(peer);
		expect(room.peers.length).toBe(0);
		expect(spyNotifyPeers).toHaveBeenCalledWith('peerClosed', { peerId: peer.id }, peer);
	});

	it('removePeer() - lobby peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		room['parkPeer'](peer);
		room.removePeer(peer);
		expect(room.peers.length).toBe(0);
		expect(spyNotifyPeers).toHaveBeenCalledWith('lobby:peerClosed', { peerId: peer.id }, peer);
	});

	it('removePeer() - last peer leaves', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room.removePeer(peer);
		expect(room.closed).toBe(true);
	});

	it('removePeer() - peer leaves, peer still there', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room['allowPeer'](peer);
		room['allowPeer'](peer2);
		room.removePeer(peer);
		expect(room.closed).toBe(false);
		room.removePeer(peer2);
		expect(room.closed).toBe(true);
	});

	it('removePeer() - peer leaves, have pending peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const pendingPeer = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(pendingPeer);
		room['allowPeer'](peer);
		room.removePeer(peer);
		expect(room.closed).toBe(false);
	});

	it('removePeer() - peer leaves, peer in lobby', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const lobbyPeer = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room['parkPeer'](lobbyPeer);
		room.removePeer(peer);
		expect(room.closed).toBe(false);
	});

	it('getPeers() - joined peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room.joinPeer(peer2);
		expect(room.getPeers()).toEqual([ peer, peer2 ]);
	});

	it('getPeers() - exclude peer', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room.joinPeer(peer2);
		expect(room.getPeers(peer)).toEqual([ peer2 ]);
	});

	it('getPeers() - lobby peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room['parkPeer'](peer2);
		expect(room.getPeers()).toEqual([ peer ]);
	});

	it('getPeers() - pending peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room['allowPeer'](peer2);
		expect(room.getPeers()).toEqual([ peer ]);
	});

	it('notifyPeers() - all peers', () => {
		const peer = new Peer({
			id: 'test',
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room.joinPeer(peer2);

		const spyNotify1 = jest.spyOn(peer, 'notify');
		const spyNotify2 = jest.spyOn(peer2, 'notify');

		expect(room.peers.length).toBe(2);

		room.notifyPeers('test', { test: 'test' });

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
			roomId: roomId,
		});

		const peer2 = new Peer({
			id: 'test2',
			roomId: roomId,
		});

		room.joinPeer(peer);
		room.joinPeer(peer2);

		const spyNotify1 = jest.spyOn(peer, 'notify');
		const spyNotify2 = jest.spyOn(peer2, 'notify');

		room.notifyPeers('test', { test: 'test' }, peer);

		expect(spyNotify1).not.toHaveBeenCalled();
		expect(spyNotify2).toHaveBeenCalledWith({
			method: 'test',
			data: { test: 'test' },
		});
	});
});