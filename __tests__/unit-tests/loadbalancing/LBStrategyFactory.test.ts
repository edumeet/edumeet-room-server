import GeoStrategy from '../../../src/loadbalancing/GeoStrategy';
import { LB_STRATEGIES } from '../../../src/loadbalancing/LBStrategy';
import LBStrategyFactory from '../../../src/loadbalancing/LBStrategyFactory';
import StickyStrategy from '../../../src/loadbalancing/StickyStrategy';

test('createStickyStrategy() should create sticky strategy', () => {
	const sut = new LBStrategyFactory([]);

	const sticky = sut.createStickyStrategy();

	expect(sticky).toBeInstanceOf(StickyStrategy);
});

test('createStrategies() should not create anything on empty config', () => {
	const sut = new LBStrategyFactory([]);

	const strategies = sut.createStrategies();

	expect(strategies).toBeInstanceOf(Map);
	expect(strategies.size).toBe(0);
});

test('createStrategies() should create geo strategy', () => {
	const sut = new LBStrategyFactory([ LB_STRATEGIES.GEO ]);

	const strategies = sut.createStrategies();

	expect(strategies).toBeInstanceOf(Map);
	expect(strategies.size).toBe(1);
	expect(strategies.get(LB_STRATEGIES.GEO)).toBeInstanceOf(GeoStrategy);
});

test('createStrategies() should throw on invalid strategy', () => {
	expect(() => new LBStrategyFactory([ 'non_existing' ])).toThrow();
});