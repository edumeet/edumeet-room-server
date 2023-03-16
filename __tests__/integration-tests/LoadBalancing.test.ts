import GeoPosition from '../../src/loadbalancing/GeoPosition';
import LBStrategyFactory from '../../src/loadbalancing/LBStrategyFactory';
import LoadBalancer, { LbCandidates } from '../../src/loadbalancing/LoadBalancer';
import MediaNode from '../../src/media/MediaNode';
import { Router } from '../../src/media/Router';
import MediaService from '../../src/MediaService';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';

const mockMediaService = {} as unknown as MediaService;
const nodeClose = {
	load: 0.2,
	id: 'id1',
	geoPosition: new GeoPosition({ latitude: 48.8543,	longitude: 2.3527 })
} as unknown as MediaNode;
const nodeFarAway = {
	load: 0.1,
	id: 'id2',
	geoPosition: new GeoPosition({ latitude: 16.8833,	longitude: 101.8833 })
} as unknown as MediaNode;
const nodeHighLoad = {
	load: 0.9,
	id: 'id3',
	geoPosition: new GeoPosition({ latitude: 59.8376, longitude: 13.143 })
} as unknown as MediaNode;
const clientDirect = { address: '5.44.192.0', forwardedFor: undefined };
const clientReverseProxy = { address: '10.244.0.1', forwardedFor: '5.44.192.0' };

test('Should use geo strategy', () => {
	const factory = new LBStrategyFactory([ 'geo' ]);
	const sut = new LoadBalancer(factory);
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

	let candidates: LbCandidates = [];
	let copyOfMediaNodes: MediaNode[];

	copyOfMediaNodes = [ nodeFarAway, nodeClose ]; 
	candidates =	sut.getCandidates({
		copyOfMediaNodes,
		room: room,
		peer: peerDirect });

	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(nodeClose.id);
	expect(candidates[1]).toBe(nodeFarAway.id);

	copyOfMediaNodes = [ nodeFarAway, nodeClose ];
	candidates =	sut.getCandidates({
		copyOfMediaNodes,
		room: room,
		peer: peerReverseProxy });

	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(nodeClose.id);
	expect(candidates[1]).toBe(nodeFarAway.id);
});

test('Geo strategy should reject active room outside threshold', () => {
	const factory = new LBStrategyFactory([ 'geo' ]);
	const sut = new LoadBalancer(factory);
	const peerDirect = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const activeRoom = new Room({
		id: 'id',
		name: 'name',
		mediaService: mockMediaService,
	});
	const spyGetActiveMediaNodes = jest.spyOn(activeRoom, 'getActiveMediaNodes');

	activeRoom.routers.add({ mediaNode: {
		id: nodeFarAway.id
	} } as unknown as Router);

	let candidates: LbCandidates = [];

	const copyOfMediaNodes = [ nodeFarAway, nodeClose ]; 

	candidates =	sut.getCandidates({
		copyOfMediaNodes,
		room: activeRoom,
		peer: peerDirect });

	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(nodeClose.id);
	expect(candidates[1]).toBe(nodeFarAway.id);
	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
});

test('Should use load strategy', () => {

	const factory = new LBStrategyFactory([ 'geo' ]);
	const sut = new LoadBalancer(factory);
	const peer = { getAddress: () => { return clientDirect; } } as unknown as Peer;
	const room = new Room({
		id: 'id',
		name: 'name',
		mediaService: mockMediaService
	});

	let candidates: LbCandidates = [];

	const copyOfMediaNodes = [ nodeHighLoad ]; 

	candidates = sut.getCandidates({ copyOfMediaNodes, room, peer });

	expect(candidates.length).toBe(0);
});