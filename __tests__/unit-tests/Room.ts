import 'jest';
import MediaService from '../../src/MediaService';
import Room from '../../src/Room';
import { Router } from '../../src/media/Router';
import LoadBalancer from '../../src/LoadBalancer';
import { Config } from '../../src/Config';
import { KDTree } from 'edumeet-common';
import { Peer } from '../../src/Peer';

describe('Room', () => {
	let room1: Room;
	let spyEmit: jest.SpyInstance;
	const roomId1 = 'testRoom1';
	const roomName1 = 'testRoomName1';
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
	});

	it('Has correct properties', () => {
		expect(room1).toBeInstanceOf(Room);
		expect(room1.id).toBe(roomId1);
		expect(room1.name).toBe(roomName1);
		expect(room1.sessionId).toBeDefined();
		expect(room1.closed).toBe(false);
		expect(room1.locked).toBe(false);

		expect(room1.routers.length).toBe(0);
		expect(room1.breakoutRooms.size).toBe(0);
		expect(room1.pendingPeers.length).toBe(0);
		expect(room1.peers.length).toBe(0);
		expect(room1.lobbyPeers.length).toBe(0);
	});

	it('close()', () => {
		room1.close();
		expect(room1.closed).toBe(true);
		expect(spyEmit).toHaveBeenCalledTimes(1);
	});

	it('notifyPeers() should notify peers in breakout rooms by default', () => {
		const peerOptions = {
			id: 'id',
		};

		const p1 = new Peer({ ...peerOptions, sessionId: room1.sessionId });
		const p2 = new Peer({ ...peerOptions, sessionId: 'breakout' });

		room1.peers.add(p1);
		room1.peers.add(p2);

		const spy1 = jest.spyOn(p1, 'notify');
		const spy2 = jest.spyOn(p2, 'notify');

		room1.notifyPeers({ method: 'test', data: {} });

		expect(spy1).toHaveBeenCalled();
		expect(spy2).toHaveBeenCalled();
	});
	
	it('notifyPeers() should be able to ignore peers in breakout rooms', () => {
		const peerOptions = {
			id: 'id',
		};

		const p1 = new Peer({ ...peerOptions, sessionId: room1.sessionId });
		const p2 = new Peer({ ...peerOptions, sessionId: 'breakout' });

		room1.peers.add(p1);
		room1.peers.add(p2);

		const spy1 = jest.spyOn(p1, 'notify');
		const spy2 = jest.spyOn(p2, 'notify');

		room1.notifyPeers({ method: 'test', data: {}, ignoreBreakout: true });

		expect(spy1).toHaveBeenCalledTimes(1);
		expect(spy2).not.toHaveBeenCalled();
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
	});
});