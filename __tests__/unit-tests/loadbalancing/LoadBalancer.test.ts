import { KDPoint, KDTree } from 'edumeet-common';
import GeoStrategy from '../../../src/loadbalancing/GeoStrategy';
import LBStrategyFactory from '../../../src/loadbalancing/LBStrategyFactory';
import LoadBalancer from '../../../src/loadbalancing/LoadBalancer';
import LoadStrategy from '../../../src/loadbalancing/LoadStrategy';
import StickyStrategy from '../../../src/loadbalancing/StickyStrategy';
import MediaNode from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import LBStrategyFactoryMock from '../../../__mocks__/LBStrategyFactoryMock';

const mediaNode1 = { id: 'id1' } as unknown as MediaNode;
const mediaNode2 = { id: 'id2' } as unknown as MediaNode;

test('Should use candidates from kdtree on no sticky', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const spyGetStickyCandidates = jest.fn().mockReturnValue([]);
	const sticky = {
		getCandidates: spyGetStickyCandidates 
	} as unknown as StickyStrategy;
	const factory = new LBStrategyFactoryMock(sticky) as unknown as LBStrategyFactory;
	const point1 = { appData: { mediaNode: mediaNode1 } } as unknown as KDPoint;
	const point2 = { appData: { mediaNode: mediaNode2 } } as unknown as KDPoint;
	const sut = new LoadBalancer(factory, point1);
	const spyNearestNeighbors = jest.fn().mockReturnValue(
		[ [ point1, 50 ], [ point2, 50 ] ]
	);
	const kdTree = {
		nearestNeighbors: spyNearestNeighbors
	} as unknown as KDTree;

	const candidates = sut.getCandidates({ room, peer, kdTree });

	expect(spyGetStickyCandidates).toHaveBeenCalledTimes(1);
	expect(spyNearestNeighbors).toHaveBeenCalledTimes(1);
	expect(candidates.length).toBe(2);
	expect(candidates[0].appData.mediaNode).toBe(mediaNode1);
	expect(candidates[1].appData.mediaNode).toBe(mediaNode2);
});

test('Should use valid sticky candidates', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;

	const fakePoint1 = {
		appData: {
			mediaNode: mediaNode1
		}
	} as unknown as KDPoint;
	const fakePoint2 = {
		appData: {
			mediaNode: mediaNode2
		}
	} as unknown as KDPoint;
	const sticky = {
		getCandidates: jest.fn().mockReturnValue([ fakePoint2 ])
	};
	const load = {
		filterOnLoad: jest.fn().mockReturnValue([ fakePoint2 ])
	} as unknown as LoadStrategy;
	const geo = {
		getClientPosition: jest.fn(),
		filterOnThreshold: jest.fn().mockReturnValue([ fakePoint2 ])
	} as unknown as GeoStrategy;
	const factory = new LBStrategyFactoryMock(
		sticky,
		load,
		geo
	) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory, fakePoint1);

	const kdTree = {
		nearestNeighbors: jest.fn().mockReturnValue([ [ fakePoint1, 50 ] ])
	} as unknown as KDTree;
	const candidates = sut.getCandidates({ room, peer, kdTree });

	expect(candidates[0].appData.mediaNode).toBe(mediaNode2);
	expect(candidates[1].appData.mediaNode).toBe(mediaNode1);
});

test('Should return empty array on error', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;

	const sticky = jest.fn().mockImplementation(() => {
		{ getCandidates: throw Error(); }
	}) as unknown as StickyStrategy;
	const factory = new LBStrategyFactoryMock(sticky) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory, {} as unknown as KDPoint);

	const kdTree = { rebalance: jest.fn() } as unknown as KDTree;
	const candidates = sut.getCandidates({ room, peer, kdTree });

	expect(candidates).toEqual([]);

});