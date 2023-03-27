import { KDPoint, KDTree } from 'edumeet-common';
import LBStrategyFactory from '../../src/loadbalancing/LBStrategyFactory';
import LoadBalancer from '../../src/loadbalancing/LoadBalancer';
import MediaNode from '../../src/media/MediaNode';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';

const mockMediaService = {} as unknown as MediaService;
const nodeClose1 = {
	load: 0.2,
	id: 'id1',
} as unknown as MediaNode;
const kdPointClose1 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose1 });
const nodeClose2 = {
	load: 0.4,
	id: 'id2',
} as unknown as MediaNode;
const kdPointClose2 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose2 });
const nodeClose3 = {
	load: 0.1,
	id: 'id3',
} as unknown as MediaNode;
const kdPointClose3 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose3 });
const nodeClose4 = {
	load: 0.1,
	id: 'id3',
} as unknown as MediaNode;
const kdPointClose4 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose4 });
const nodeClose5 = {
	load: 0.1,
	id: 'id3',
} as unknown as MediaNode;
const kdPointClose5 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose5 });
const nodeFarAway = {
	load: 0.1,
	id: 'id3',
} as unknown as MediaNode;
const kdPointFarAway = new KDPoint([ 16.8833,	 101.8833 ], { mediaNode: nodeFarAway });
const nodeHighLoad = {
	load: 0.9,
	id: 'id4',
} as unknown as MediaNode;
const kdPointHighLoad = new KDPoint([ 59.8376, 13.143 ], { mediaNode: nodeHighLoad });

const clientDirect = { address: '5.44.192.0', forwardedFor: undefined };
const clientReverseProxy = { address: '10.244.0.1', forwardedFor: '5.44.192.0' };

test('Should use sticky strategy', () => {
	const factory = new LBStrategyFactory();
	const sut = new LoadBalancer(factory, new KDPoint([ 16, 101 ]));
	const peerDirect = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const peerReverseProxy = {
		getAddress: () => {
			return clientReverseProxy; 
		} } as unknown as Peer;
	const room = new Room({
		id: 'id',
		name: 'name',
		mediaService: mockMediaService
	});

	let candidates: KDPoint[];
	const kdTree = new KDTree([ kdPointClose1, kdPointClose2 ]);

	candidates =	sut.getCandidates({
		room: room,
		peer: peerDirect,
		kdTree });

	expect(candidates.length).toBe(2);

	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		mediaService: mockMediaService
	});
	const router = { mediaNode: {
		kdPoint: kdPointClose2
	} } as unknown as Router;

	activeRoom.addRouter(router);
	candidates = sut.getCandidates({
		room: activeRoom,
		peer: peerReverseProxy,
		kdTree
	});

	expect(candidates.length).toBe(3);
	expect(candidates[0]).toBe(kdPointClose2);
});

test('Geo strategy should reject active room outside threshold', () => {
	const factory = new LBStrategyFactory();
	const sut = new LoadBalancer(factory, new KDPoint([ 40, 40 ]));
	const peerDirect = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		mediaService: mockMediaService,
	});
	const spyGetActiveMediaNodes = jest.spyOn(activeRoom, 'getActiveMediaNodes');

	const router = { mediaNode: {
		kdPoint: kdPointFarAway
	} } as unknown as Router;

	activeRoom.addRouter(router);
	let kdTree = new KDTree([]);
	let candidates = sut.getCandidates({
		room: activeRoom,
		peer: peerDirect,
		kdTree
	});

	expect(candidates.length).toBe(0);
	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);

	kdTree = new KDTree([
		kdPointClose1,
		kdPointClose2,
		kdPointClose3,
		kdPointClose4,
		kdPointClose5,
	]);

	candidates = sut.getCandidates({
		room: activeRoom,
		peer: peerDirect,
		kdTree
	});

	expect(candidates.length).toBe(5);
	expect(candidates).not.toContain(kdPointFarAway);
	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(2);
});

test('Should use load strategy', () => {

	const factory = new LBStrategyFactory();
	const sut = new LoadBalancer(factory, new KDPoint([ 40, 40 ]));
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		mediaService: mockMediaService
	});

	let kdTree = new KDTree([]);
	const router = { mediaNode: {
		kdPoint: kdPointHighLoad
	} } as unknown as Router;

	activeRoom.addRouter(router);

	let candidates = sut.getCandidates({ room: activeRoom, peer, kdTree });

	expect(candidates.length).toBe(0);
	
	kdTree = new KDTree([ kdPointClose1 ]);
	candidates = sut.getCandidates({ room: activeRoom, peer, kdTree });

	expect(candidates.length).toBe(1);
	expect(candidates).not.toContain(kdPointHighLoad);
});