import { KDPoint, KDTree } from 'edumeet-common';
import LoadBalancer from '../../src/LoadBalancer';
import MediaNode from '../../src/media/MediaNode';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';

const kdPoint1 = new KDPoint([ 50, 10 ]);
const kdPoint2= new KDPoint([ 50, 10 ]);
const mediaNode1 = { id: 'id1', load: 0.2, kdPoint: kdPoint1 } as unknown as MediaNode;
const mediaNode2 = { id: 'id2', load: 0.3, kdPoint: kdPoint2 } as unknown as MediaNode;
const mediaNode3 = { id: 'id2', load: 0.9, kdPoint: kdPoint2 } as unknown as MediaNode;
const defaultClientPosition = new KDPoint([ 50, 10 ]);
const clientAddress = '5.44.192.0';

test.each([
	[ clientAddress, undefined ],
	[ undefined, clientAddress ]
])('Should use candidates from kdtree on no sticky candidates', (address, forwardedFor) => {
	const spyGetActiveMediaNodes = jest.fn().mockReturnValue([]);
	const room = {
		getActiveMediaNodes: spyGetActiveMediaNodes
	} as unknown as Room;
	const peer = { getAddress: jest.fn().mockReturnValue({
		address,
		forwardedFor
	})
	} as unknown as Peer;
	const point1 = { appData: { mediaNode: mediaNode1 } } as unknown as KDPoint;
	const point2 = { appData: { mediaNode: mediaNode2 } } as unknown as KDPoint;
	const spyNearestNeighbors = jest.fn().mockReturnValue(
		[ [ point1, 50 ], [ point2, 50 ] ]
	);
	const kdTree = {
		nearestNeighbors: spyNearestNeighbors
	} as unknown as KDTree;

	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const candidates = sut.getCandidates(room, peer);

	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);
	expect(spyNearestNeighbors).toHaveBeenCalledTimes(1);
	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(mediaNode1);
	expect(candidates[1]).toBe(mediaNode2);
});

test('Should place sticky candidate first return array', () => {
	const spyGetActiveMediaNodes = jest.fn().mockReturnValue([ mediaNode2 ]);
	const room = {
		getActiveMediaNodes: spyGetActiveMediaNodes
	} as unknown as Room;
	const peer = { getAddress: jest.fn().mockReturnValue({
		address: clientAddress,
		undefined
	})
	} as unknown as Peer;
	const point1 = { appData: { mediaNode: mediaNode1 } } as unknown as KDPoint;
	const spyNearestNeighbors = jest.fn().mockReturnValue(
		[ [ point1, 50 ] ]
	);
	const kdTree = {
		nearestNeighbors: spyNearestNeighbors
	} as unknown as KDTree;

	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const candidates = sut.getCandidates(room, peer);

	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);
	expect(spyNearestNeighbors).toHaveBeenCalledTimes(1);
	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(mediaNode2);
	expect(candidates[1]).toBe(mediaNode1);
});

test('Should sort sticky candidates on load', () => {
	const spyGetActiveMediaNodes = jest.fn().mockReturnValue([
		mediaNode2,
		mediaNode1
	]);
	const room = {
		getActiveMediaNodes: spyGetActiveMediaNodes
	} as unknown as Room;
	const peer = { getAddress: jest.fn().mockReturnValue({
		address: clientAddress,
		forwardedFor: undefined
	})
	} as unknown as Peer;
	const spyNearestNeighbors = jest.fn().mockReturnValue(
		[ ]
	);
	const kdTree = {
		nearestNeighbors: spyNearestNeighbors
	} as unknown as KDTree;

	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const candidates = sut.getCandidates(room, peer);

	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);
	expect(spyNearestNeighbors).toHaveBeenCalledTimes(1);
	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(mediaNode1);
	expect(candidates[1]).toBe(mediaNode2);
});

test('Should filter out candidates on load', () => {
	const spyGetActiveMediaNodes = jest.fn().mockReturnValue([
		mediaNode3
	]);
	const room = {
		getActiveMediaNodes: spyGetActiveMediaNodes
	} as unknown as Room;
	const peer = { getAddress: jest.fn().mockReturnValue({
		address: clientAddress,
		forwardedFor: undefined
	})
	} as unknown as Peer;
	const kdTree = new KDTree([ new KDPoint([ 50, 10 ], { mediaNode: mediaNode3 }) ]
	);
	const sut = new LoadBalancer({ kdTree, defaultClientPosition, cpuLoadThreshold: 0.85 });
	const candidates = sut.getCandidates(room, peer);

	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);
	expect(candidates.length).toBe(0);
});

test('Should fallback to default client geoposition', () => {
	const spyGetActiveMediaNodes = jest.fn().mockReturnValue([]);
	const room = {
		getActiveMediaNodes: spyGetActiveMediaNodes
	} as unknown as Room;
	const peer = { getAddress: jest.fn().mockReturnValue({
		address: undefined,
		forwardedFor: undefined
	})
	} as unknown as Peer;
	const point1 = { appData: { mediaNode: mediaNode1 } } as unknown as KDPoint;
	const spyNearestNeighbors = jest.fn().mockReturnValue(
		[ [ point1, 50 ] ]
	);
	const kdTree = {
		nearestNeighbors: spyNearestNeighbors
	} as unknown as KDTree;

	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const candidates = sut.getCandidates(room, peer);

	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);
	expect(spyNearestNeighbors).toHaveBeenCalledTimes(1);
	expect(candidates.length).toBe(1);
	expect(candidates[0]).toBe(mediaNode1);
});

test('Should fallback to default client geoposition', () => {
	const spyGetActiveMediaNodes = jest.fn().mockReturnValue(new Error('lol'));
	const room = {
		getActiveMediaNodes: spyGetActiveMediaNodes
	} as unknown as Room;
	const peer = { getAddress: jest.fn().mockReturnValue({
		address: undefined,
		forwardedFor: undefined
	})
	} as unknown as Peer;
	const point1 = { appData: { mediaNode: mediaNode1 } } as unknown as KDPoint;
	const spyNearestNeighbors = jest.fn().mockReturnValue(
		[ [ point1, 50 ] ]
	);
	const kdTree = {
		nearestNeighbors: spyNearestNeighbors
	} as unknown as KDTree;

	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const candidates = sut.getCandidates(room, peer);

	expect(candidates.length).toBe(0);
});
