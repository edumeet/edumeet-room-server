import 'jest';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaNode from '../../src/media/MediaNode';
import { LoadBalancer } from '../../src/loadbalance/LoadBalancer';

const lb = { getCandidates: jest.fn().mockImplementation(() => {
	return [];
}) } as unknown as LoadBalancer;

describe('MediaService', () => {
	let mediaService: MediaService;

	beforeEach(() => {
		mediaService = new MediaService(lb);
		mediaService.mediaNodes.clear(); // We don't want nodes from config
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(mediaService.closed).toBe(false);
	});

	it('close()', () => {
		mediaService.close();
		expect(mediaService.closed).toBe(true);
		expect(mediaService.mediaNodes.length).toBe(0);
	});

	describe('Router', () => {
		const ERROR_MSG_NO_MEDIA_NODES = 'no media nodes available';
		const ERROR_MSG_ROOM_CLOSED = 'room closed';
		let fakeMediaNode1: MediaNode;
		let mockGetRouter: jest.SpyInstance;
		let spyMediaNode1GetRouter: jest.SpyInstance;
		let fakeRoom: Room;
		let fakePeer: Peer;
		let spyRoomAddRouter: jest.SpyInstance;

		beforeEach(() => {
			mockGetRouter = jest.fn().mockImplementation(async () => {	
				return { close: jest.fn() } as unknown as Router;
			});
			fakeRoom = {
				id: 'id',
				parentClose: false,
				addRouter: jest.fn()
			} as unknown as Room;
			fakePeer = {
				id: 'id'
			} as unknown as Peer;
			fakeMediaNode1 = {
				getRouter: mockGetRouter
			} as unknown as MediaNode;
			spyRoomAddRouter = jest.spyOn(fakeRoom, 'addRouter');
			spyMediaNode1GetRouter = jest.spyOn(fakeMediaNode1, 'getRouter');
		});

		it('getRouter() - Should add router to room when parent not closed', async () => {
			mediaService.mediaNodes.add(fakeMediaNode1);

			expect(mediaService.mediaNodes.length).toBe(1);
			
			await mediaService.getRouter(fakeRoom, fakePeer);

			expect(spyRoomAddRouter).toHaveBeenCalled();
		});
		
		it('getRouter() - Should throw when parent room have closed', async () => {
			const roomWithClosedParent = { ...fakeRoom, parentClosed: true } as unknown as Room;

			mediaService.mediaNodes.add(fakeMediaNode1);
			
			await expect(mediaService.getRouter(roomWithClosedParent, fakePeer)).
				rejects.toThrowError(ERROR_MSG_ROOM_CLOSED);
			expect(spyRoomAddRouter).not.toHaveBeenCalled();
		});
		
		it('getRouter() - Should throw on no mediaNodes', async () => {
			await expect(mediaService.getRouter(fakeRoom, fakePeer)).
				rejects.toThrowError(ERROR_MSG_NO_MEDIA_NODES);
		});
		
		it('getRouter() - Should call getRouter on mediaNode', async () => {
			mediaService.mediaNodes.add(fakeMediaNode1);
			
			mediaService.getRouter(fakeRoom, fakePeer);

			expect(spyMediaNode1GetRouter).toHaveBeenCalledTimes(1);
		});
		
		it('getRouter() - Should use mediaNode candidate given by loadbalancer', async () => {
			const fakeMediaNode2 = {
				getRouter: jest.fn(),
			} as unknown as MediaNode;
			const spyMediaNode2GetRouter = jest.spyOn(fakeMediaNode2, 'getRouter');

			mediaService.mediaNodes.add(fakeMediaNode1);
			mediaService.mediaNodes.add(fakeMediaNode2);
			jest.spyOn(lb, 'getCandidates').mockImplementation(() => {
				return [ fakeMediaNode2, fakeMediaNode1 ]; 
			});
			
			mediaService.getRouter(fakeRoom, fakePeer);

			expect(spyMediaNode1GetRouter).toHaveBeenCalledTimes(0);
			expect(spyMediaNode2GetRouter).toHaveBeenCalledTimes(1);
		});
	});
});