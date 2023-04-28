import 'jest';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaNode from '../../src/media/MediaNode';
import LoadBalancer from '../../src/LoadBalancer';
import { Config } from '../../src/Config';
import { KDTree } from 'edumeet-common';

const config = {
	listenPort: 3000,
	listenHost: 3000,
	mediaNodes: [],
} as unknown as Config;
		
describe('MediaService', () => {
	it('Has correct properties', () => {
		const kdTree = { rebalance: jest.fn() } as unknown as KDTree;
		const loadBalancer = {} as unknown as LoadBalancer;
		const sut = MediaService.create(loadBalancer, kdTree, config); 

		expect(sut.closed).toBe(false);
	});

	it('close()', () => {
		const kdTree = { rebalance: jest.fn() } as unknown as KDTree;
		const loadBalancer = {} as unknown as LoadBalancer;
		const sut = MediaService.create(loadBalancer, kdTree, config); 

		sut.close();
		expect(sut.closed).toBe(true);
		expect(sut.mediaNodes.length).toBe(0);
	});

	describe('Router', () => {
		const ERROR_MSG_NO_MEDIA_NODES = 'no media nodes available';
		const ERROR_MSG_ROOM_CLOSED = 'room closed';
		let fakeMediaNode1: MediaNode;
		let mockGetRouter: jest.SpyInstance;
		let fakePeer: Peer;

		beforeEach(() => {
			mockGetRouter = jest.fn().mockImplementation(async () => {	
				return { close: jest.fn() } as unknown as Router;
			});
			fakePeer = {
				id: 'id'
			} as unknown as Peer;
			fakeMediaNode1 = {
				id: 'id1',
				getRouter: mockGetRouter
			} as unknown as MediaNode;
		});
		afterEach(() => {
			jest.clearAllMocks();
		});

		it('getRouter() - Should add router to room when parent not closed', async () => {
			const spyGetCandidates = jest.fn().mockReturnValue([ fakeMediaNode1 ]);
			const loadBalancer = {
				getCandidates: spyGetCandidates
			} as unknown as LoadBalancer; 
			const spyRoomAddRouter = jest.fn();
			const fakeRoom = {
				id: 'id',
				parentClose: false,
				addRouter: spyRoomAddRouter
			} as unknown as Room;
			const kdTree = { rebalance: jest.fn() 
			} as unknown as KDTree;
			
			const sut = MediaService.create(loadBalancer, kdTree, config); 

			await sut.getRouter(fakeRoom, fakePeer);

			expect(spyRoomAddRouter).toHaveBeenCalled();
			expect(spyGetCandidates).toHaveBeenCalled();
		});
		
		it('getRouter() - Should throw on no mediaNodes', async () => {
			const loadBalancer = { getCandidates: jest.fn().mockImplementation(() => {
				return [];
			}) } as unknown as LoadBalancer; 
			const fakeRoom = {
				id: 'id',
				parentClose: false,
				addRouter: jest.fn()
			} as unknown as Room;

			jest.spyOn(loadBalancer, 'getCandidates').mockImplementation(() => {
				return [];
			});
			const kdTree = { rebalance: jest.fn()
			} as unknown as KDTree;
			const sut = MediaService.create(loadBalancer, kdTree, config); 

			await expect(sut.getRouter(fakeRoom, fakePeer)).
				rejects.toThrowError(ERROR_MSG_NO_MEDIA_NODES);
		});
	});
});