import { KDPoint, KDTree } from 'edumeet-common';
import LoadBalancer from '../../src/LoadBalancer';
import MediaNode, { ConnectionStatus } from '../../src/media/MediaNode';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';

const mockMediaService = {} as unknown as MediaService;
const mockObserver = { on: jest.fn() };
const mockCreateObserver = jest.fn().mockReturnValue(mockObserver);
const nodeClose1 = {
	load: 0.2,
	id: 'id1',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 48.8543,	 2.3527 ])
} as unknown as MediaNode;
const kdPointClose1 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose1 });
const nodeClose2 = {
	load: 0.4,
	id: 'id2',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 48.8543,	 2.3527 ])
} as unknown as MediaNode;
const kdPointClose2 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose2 });
const nodeClose3 = {
	load: 0.1,
	id: 'id3',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 48.8543,	 2.3527 ])
} as unknown as MediaNode;
const kdPointClose3 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose3 });
const nodeClose4 = {
	load: 0.1,
	id: 'id3',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 48.8543,	 2.3527 ])

} as unknown as MediaNode;
const kdPointClose4 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose4 });
const nodeClose5 = {
	load: 0.1,
	id: 'id3',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 48.8543,	 2.3527 ])
} as unknown as MediaNode;
const kdPointClose5 = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: nodeClose5 });
const nodeFarAway = {
	load: 0.1,
	id: 'id3',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 16.8833,	 101.8833 ])
} as unknown as MediaNode;
const nodeHighLoad = {
	load: 0.9,
	id: 'id4',
	connectionStatus: ConnectionStatus.OK,
	kdPoint: new KDPoint([ 48.8543,	 2.3527 ])
} as unknown as MediaNode;
const kdPointHighLoad = new KDPoint([ 48.8543, 2.3527 ], { mediaNode: nodeHighLoad });

const clientDirect = { address: '5.44.192.0', forwardedFor: undefined };
const clientReverseProxy = { address: '10.244.0.1', forwardedFor: '5.44.192.0' };

test('Should use sticky strategy', () => {
	const defaultClientPosition = new KDPoint([ 16, 101 ]);
	const kdTree = new KDTree([ kdPointClose1, kdPointClose2 ]);
	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const peerDirect = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const peerReverseProxy = {
		getAddress: () => {
			return clientReverseProxy; 
		} } as unknown as Peer;
	const room = new Room({
		id: 'id',
		name: 'name',
		tenantId: '1',
		mediaService: mockMediaService
	});

	let candidates = sut.getCandidates(room, peerDirect);

	expect(candidates.length).toBe(2);

	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		tenantId: '1',
		mediaService: mockMediaService
	});
	const router = { mediaNode: nodeClose3, createActiveSpeakerObserver: mockCreateObserver } as unknown as Router;

	activeRoom.addRouter(router);
	candidates = sut.getCandidates(activeRoom, peerReverseProxy);

	expect(candidates.length).toBe(3);
	expect(candidates[0]).toBe(nodeClose3);
});

test('Geo strategy should reject active room outside threshold', () => {
	const defaultClientPosition = new KDPoint([ 50, 11 ]);
	const kdTree = new KDTree([
		kdPointClose1,
		kdPointClose2,
		kdPointClose3,
		kdPointClose4,
		kdPointClose5,
	]);
	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const peerDirect = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		tenantId: '1',
		mediaService: mockMediaService,
	});
	const spyGetActiveMediaNodes = jest.spyOn(activeRoom, 'getActiveMediaNodes');

	const router = { mediaNode: nodeFarAway, createActiveSpeakerObserver: mockCreateObserver } as unknown as Router;

	activeRoom.addRouter(router);
	const candidates = sut.getCandidates(activeRoom, peerDirect);

	expect(candidates.length).toBe(5);
	expect(spyGetActiveMediaNodes).toHaveBeenCalledTimes(1);
	expect(candidates).not.toContain(nodeFarAway);
});

test('Should use load strategy', () => {
	const defaultClientPosition = new KDPoint([ 40, 40 ]);
	const kdTree = new KDTree([ kdPointClose1 ]);
	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		tenantId: '1',
		mediaService: mockMediaService
	});

	const router = { mediaNode: nodeHighLoad, createActiveSpeakerObserver: mockCreateObserver } as unknown as Router;

	activeRoom.addRouter(router);

	const candidates = sut.getCandidates(activeRoom, peer);

	expect(candidates.length).toBe(1);
	expect(candidates).not.toContain(kdPointHighLoad);
});

test('Should filter on media-node health', () => {
	const unhealthyMediaNode = {
		load: 0.2,
		id: 'id1',
		health: false,
		kdPoint: new KDPoint([ 48.8543,	 2.3527 ])
	} as unknown as MediaNode;
	const kdPoint = new KDPoint([ 48.8543,	 2.3527 ], { mediaNode: unhealthyMediaNode });
	const defaultClientPosition = new KDPoint([ 40, 40 ]);
	
	// KDTree will consider the unhealthy MediaNode and should filter it out.
	const kdTree = new KDTree([ kdPoint ]);
	const sut = new LoadBalancer({ kdTree, defaultClientPosition });
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		tenantId: '1',
		mediaService: mockMediaService
	});

	const router = { mediaNode: unhealthyMediaNode, createActiveSpeakerObserver: mockCreateObserver } as unknown as Router;

	// This will make the MediaNode sticky candidate, which should be filtered out.
	activeRoom.addRouter(router);

	const candidates = sut.getCandidates(activeRoom, peer);

	expect(candidates.length).toBe(0);
	expect(candidates).not.toContain(kdPoint);
});