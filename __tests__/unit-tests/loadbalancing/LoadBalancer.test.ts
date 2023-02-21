import { List } from 'edumeet-common';
import { LBStrategyFactory } from '../../../src/loadbalance/LBStrategyFactory';
import { LoadBalancer } from '../../../src/loadbalance/LoadBalancer';
import MediaNode from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import LBStrategyFactoryMock from '../../../__mocks__/LBStrategyFactoryMock';

const mediaNode1 = {} as unknown as MediaNode;
const mediaNode2 = {} as unknown as MediaNode;

test('Should return mediaNodes on no candidates', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const mediaNodes = List<MediaNode>();

	mediaNodes.add(mediaNode1);
	mediaNodes.add(mediaNode2);
	const sticky = {
		getCandidates: jest.fn().mockImplementation(() => {
			return [];
		})
	};
	const factory = new LBStrategyFactoryMock(sticky) as unknown as LBStrategyFactory;
	const spyCreateSticky = jest.spyOn(factory, 'createStickyStrategy');
	const spyCreateStrategies = jest.spyOn(factory, 'createStrategies');
	const sut = new LoadBalancer(factory);
	const spyStickyGetCandidates = jest.spyOn(sticky, 'getCandidates');

	const candidates = sut.getCandidates(mediaNodes, room, peer);

	expect(spyCreateSticky).toHaveBeenCalledTimes(1);
	expect(spyCreateStrategies).toHaveBeenCalledTimes(1);
	expect(spyStickyGetCandidates).toHaveBeenCalledTimes(1);
	expect(candidates).toBe(mediaNodes.items);
});

test('Should return candidates on sticky candidates', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const mediaNodes = List<MediaNode>();

	const stickyCandidates = [ mediaNode1 ];
	const sticky = {
		getCandidates: jest.fn().mockImplementation(() => {
			return stickyCandidates;
		})
	};
	const factory = new LBStrategyFactoryMock(sticky) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory);

	const candidates = sut.getCandidates(mediaNodes, room, peer);

	expect(candidates).toBe(stickyCandidates);
});

test('Should use geo candidates when geo strategy', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const mediaNodes = List<MediaNode>();

	mediaNodes.add(mediaNode1);
	mediaNodes.add(mediaNode2);
	const strategies = new Map<string, any>();
	const geoCandidates = [ mediaNode2 ];
	const mockGeoStrategy = {
		getCandidates: jest.fn().mockImplementation(() => {
			return geoCandidates;
		})
	};
	const spyGetCandidates = jest.spyOn(mockGeoStrategy, 'getCandidates');

	strategies.set('geo', mockGeoStrategy);
	const factory = new LBStrategyFactoryMock(
		null,
		strategies
	) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory);

	const candidates = sut.getCandidates(mediaNodes, room, peer);
    
	expect(candidates).toBe(geoCandidates);
	expect(spyGetCandidates).toHaveBeenCalledTimes(1);
});