import { KDPoint } from 'edumeet-common';
import GeoStrategy from '../../../src/loadbalancing/GeoStrategy';
import LBStrategyFactory from '../../../src/loadbalancing/LBStrategyFactory';
import LoadStrategy from '../../../src/loadbalancing/LoadStrategy';
import StickyStrategy from '../../../src/loadbalancing/StickyStrategy';

test('createStickyStrategy() should create sticky strategy', () => {
	const sut = new LBStrategyFactory();

	const sticky = sut.createStickyStrategy();

	expect(sticky).toBeInstanceOf(StickyStrategy);
});

test('createGeoStrategy() should not create load strategy', () => {
	const sut = new LBStrategyFactory();

	const strategy = sut.createLoadStrategy();

	expect(strategy).toBeInstanceOf(LoadStrategy);
});

test('createStrategies() should create geo strategy', () => {
	const sut = new LBStrategyFactory();

	const strategy = sut.createGeoStrategy({} as unknown as KDPoint);

	expect(strategy).toBeInstanceOf(GeoStrategy);
});
