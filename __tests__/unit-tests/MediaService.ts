import 'jest';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaNode from '../../src/media/MediaNode';
import LoadBalancer from '../../src/loadbalancing/LoadBalancer';

describe('MediaService', () => {
	it('Has correct properties', () => {
		const sut = new MediaService({} as unknown as LoadBalancer);

		expect(sut.closed).toBe(false);
	});

	it('close()', () => {
		const sut = new MediaService({} as unknown as LoadBalancer);

		sut.close();
		expect(sut.closed).toBe(true);
		expect(sut.mediaNodes.length).toBe(0);
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
		let lb: LoadBalancer;
		let mediaService: MediaService;

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
				id: 'id1',
				getRouter: mockGetRouter
			} as unknown as MediaNode;
			spyRoomAddRouter = jest.spyOn(fakeRoom, 'addRouter');
			spyMediaNode1GetRouter = jest.spyOn(fakeMediaNode1, 'getRouter');
			lb = { getCandidates: jest.fn().mockImplementation(() => {
				return [ fakeMediaNode1.id ];
			}) } as unknown as LoadBalancer; 
			mediaService = new MediaService(lb);
			mediaService.mediaNodes.clear();
		});
		afterEach(() => {
			jest.clearAllMocks();
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
			jest.spyOn(lb, 'getCandidates').mockImplementation(() => {
				return [];
			});
			await expect(mediaService.getRouter(fakeRoom, fakePeer)).
				rejects.toThrowError(ERROR_MSG_NO_MEDIA_NODES);
		});
		
		it('getRouter() - Should call getRouter on mediaNode', async () => {
			mediaService.mediaNodes.add(fakeMediaNode1);
			
			await mediaService.getRouter(fakeRoom, fakePeer);

			expect(spyMediaNode1GetRouter).toHaveBeenCalledTimes(1);
		});
		
		it('getRouter() - Should use candidates given by loadbalancer', async () => {
			const fakeMediaNode2 = {
				id: 'id2',
				getRouter: jest.fn(),
			} as unknown as MediaNode;
			const spyMediaNode2GetRouter = jest.spyOn(fakeMediaNode2, 'getRouter');

			const loadBalancer = {
				getCandidates: () => { return [ fakeMediaNode2.id ]; } 
			} as unknown as LoadBalancer;
			const sut = new MediaService(loadBalancer);

			sut.mediaNodes.add(fakeMediaNode1);
			sut.mediaNodes.add(fakeMediaNode2);
			
			await sut.getRouter(fakeRoom, fakePeer);

			expect(spyMediaNode1GetRouter).toHaveBeenCalledTimes(0);
			expect(spyMediaNode2GetRouter).toHaveBeenCalledTimes(1);
		});
	});
});