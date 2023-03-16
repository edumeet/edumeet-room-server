import LBStrategy from '../../../src/loadbalancing/LBStrategy';
import LBStrategyFactory from '../../../src/loadbalancing/LBStrategyFactory';
import LoadBalancer from '../../../src/loadbalancing/LoadBalancer';
import LoadStrategy from '../../../src/loadbalancing/LoadStrategy';
import StickyStrategy from '../../../src/loadbalancing/StickyStrategy';
import MediaNode from '../../../src/media/MediaNode';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import LBStrategyFactoryMock from '../../../__mocks__/LBStrategyFactoryMock';

const mediaNode1 = {} as unknown as MediaNode;
const mediaNode2 = {} as unknown as MediaNode;

test('Should return original order on no candidates', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const copyOfMediaNodes: MediaNode[] = [];

	copyOfMediaNodes.push(mediaNode1);
	copyOfMediaNodes.push(mediaNode2);
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

	const candidates = sut.getCandidates({ copyOfMediaNodes, room, peer });

	expect(spyCreateSticky).toHaveBeenCalledTimes(1);
	expect(spyCreateStrategies).toHaveBeenCalledTimes(1);
	expect(spyStickyGetCandidates).toHaveBeenCalledTimes(1);
	expect(candidates[0]).toBe(copyOfMediaNodes[0].id);
	expect(candidates[1]).toBe(copyOfMediaNodes[1].id);
});

test('Should return candidates on sticky candidates', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const copyOfMediaNodes: MediaNode[] = [];

	copyOfMediaNodes.push(mediaNode1);
	copyOfMediaNodes.push(mediaNode2);

	const stickyCandidates = [ mediaNode2 ];
	const sticky = {
		getCandidates: jest.fn().mockImplementation(() => {
			return stickyCandidates;
		})
	};
	const factory = new LBStrategyFactoryMock(sticky) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory);

	const candidates = sut.getCandidates({ copyOfMediaNodes, room, peer });

	expect(candidates[0]).toBe(copyOfMediaNodes[1].id);
	expect(candidates[1]).toBe(stickyCandidates[0].id);
});

test('Should use geo candidates when geo strategy', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const copyOfMediaNodes: MediaNode[] = [];

	copyOfMediaNodes.push(mediaNode1);
	copyOfMediaNodes.push(mediaNode2);
	const strategies = new Map<string, LBStrategy>();
	const geoCandidates = [ mediaNode2 ];
	const mockGeoStrategy = {
		getCandidates: jest.fn().mockImplementation(() => {
			return geoCandidates;
		})
	};
	const mockLoadStrategy = {
		getCandidates: jest.fn().mockImplementation(() => {
			return geoCandidates;
		})
	};
	const spyGetCandidates = jest.spyOn(mockGeoStrategy, 'getCandidates');

	strategies.set('geo', mockGeoStrategy);
	const factory = new LBStrategyFactoryMock(
		null as unknown as StickyStrategy,
		mockLoadStrategy as unknown as LoadStrategy,
		strategies
	) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory);

	const candidates = sut.getCandidates({ copyOfMediaNodes, room, peer });
    
	expect(candidates[0]).toBe(mediaNode2.id);
	expect(candidates[1]).toBe(mediaNode1.id);
	expect(spyGetCandidates).toHaveBeenCalledTimes(1);
});

test('Should return empty array on error', () => {
	const room = {} as unknown as Room;
	const peer = {} as unknown as Peer;
	const copyOfMediaNodes: MediaNode[] = [];

	const sticky = jest.fn().mockImplementation(() => {
		{ getCandidates: throw Error(); }
	}) as unknown as StickyStrategy;
	const factory = new LBStrategyFactoryMock(sticky) as unknown as LBStrategyFactory;
	const sut = new LoadBalancer(factory);

	const candidates = sut.getCandidates({ copyOfMediaNodes, room, peer });

	expect(candidates).toEqual([]);

});