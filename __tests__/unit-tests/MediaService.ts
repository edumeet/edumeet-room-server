import 'jest';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaNode from '../../src/media/MediaNode';
import LoadBalancer from '../../src/loadbalancing/LoadBalancer';
import { Config } from '../../src/Config';
import { KDPoint, KDTree } from 'edumeet-common';

const config = {
	listenPort: 3000,
	listenHost: 3000,
	mediaNodes: [],
	loadBalancingStrategies: []
} as unknown as Config;
		
describe('MediaService', () => {
	it('Has correct properties', () => {
		const kdTree = { rebalance: jest.fn() } as unknown as KDTree;
		const loadBalancer = {} as unknown as LoadBalancer;
		const sut = new MediaService({ loadBalancer, config, kdTree });

		expect(sut.closed).toBe(false);
	});

	it('close()', () => {
		const kdTree = { rebalance: jest.fn() } as unknown as KDTree;
		const loadBalancer = {} as unknown as LoadBalancer;
		const sut = new MediaService({ loadBalancer, config, kdTree });

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
			spyMediaNode1GetRouter = jest.spyOn(fakeMediaNode1, 'getRouter');
		});
		afterEach(() => {
			jest.clearAllMocks();
		});

		it('getRouter() - Should add router to room when parent not closed', async () => {
			const fakePoint = {
				appData: {
					mediaNode: fakeMediaNode1
				}
			} as unknown as KDPoint;
			const spyGetCandidates = jest.fn().mockReturnValue([ fakePoint ]);
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
			const sut = new MediaService({ loadBalancer, config, kdTree });
			
			await sut.getRouter(fakeRoom, fakePeer);

			expect(spyRoomAddRouter).toHaveBeenCalled();
			expect(spyGetCandidates).toHaveBeenCalled();
		});
		
		it('getRouter() - Should throw when parent room have closed', async () => {
			const fakePoint = {
				appData: {
					mediaNode: fakeMediaNode1
				}
			} as unknown as KDPoint;
			const spyGetCandidates = jest.fn().mockReturnValue([ fakePoint ]);
			const loadBalancer = {
				getCandidates: spyGetCandidates
			} as unknown as LoadBalancer; 
			const fakeRoom = {
				id: 'id',
				parentClose: false,
				addRouter: jest.fn()
			} as unknown as Room;
			const roomWithClosedParent = { ...fakeRoom, parentClosed: true } as unknown as Room;
			const spyRoomAddRouter = jest.spyOn(fakeRoom, 'addRouter');
			
			const kdTree = { rebalance: jest.fn()
			} as unknown as KDTree;
			const sut = new MediaService({ loadBalancer, config, kdTree });

			await expect(sut.getRouter(roomWithClosedParent, fakePeer)).
				rejects.toThrowError(ERROR_MSG_ROOM_CLOSED);
			expect(spyRoomAddRouter).not.toHaveBeenCalled();
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
			const sut = new MediaService({ loadBalancer, config, kdTree });

			await expect(sut.getRouter(fakeRoom, fakePeer)).
				rejects.toThrowError(ERROR_MSG_NO_MEDIA_NODES);
		});
		
		it('getRouter() - Should use candidates given by loadbalancer', async () => {
			const fakeRoom = {
				id: 'id',
				parentClose: false,
				addRouter: jest.fn()
			} as unknown as Room;
			const fakeMediaNode2= {
				id: 'id2',
				getRouter: jest.fn(),
			} as unknown as MediaNode;
			const fakePoint = {
				appData: {
					mediaNode: fakeMediaNode2
				}
			};
			const spyMediaNode2GetRouter = jest.spyOn(fakeMediaNode2, 'getRouter');

			const loadBalancer = {
				getCandidates: () => { return [ fakePoint ]; } 
			} as unknown as LoadBalancer;
			const spyNearestNeighbors = jest.fn().mockReturnValue([ [ fakePoint, 150 ] ]);
			const kdTree = {
				nearestNeighbors: spyNearestNeighbors,
				rebalance: jest.fn() } as unknown as KDTree;
			const sut = new MediaService({ loadBalancer, config, kdTree });

			sut.mediaNodes.add(fakeMediaNode1);
			sut.mediaNodes.add(fakeMediaNode2);
			
			await sut.getRouter(fakeRoom, fakePeer);

			expect(spyMediaNode1GetRouter).toHaveBeenCalledTimes(0);
			expect(spyMediaNode2GetRouter).toHaveBeenCalledTimes(1);
		});
	});
});