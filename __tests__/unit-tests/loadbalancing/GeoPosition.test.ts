import GeoPosition, { GeoPositionOptions } from '../../../src/loadbalancing/GeoPosition';
import * as geoip from 'geoip-lite';

test('expect empty args to throw', () => {
	const input = 'wrong' as unknown as GeoPositionOptions;

	expect(() => new GeoPosition(input)).toThrow();
});

test('expect close node to be close', () => {
	const geo = geoip.lookup('2.248.0.10');

	if (geo) {
		expect(geo.ll[0]).toBeGreaterThan(58);
		expect(geo.ll[0]).toBeLessThan(60);
		expect(geo.ll[1]).toBeGreaterThan(13);
		expect(geo.ll[1]).toBeLessThan(14);
	}
});

test('expect middle node to be middle', () => {
	const geo = geoip.lookup('194.177.32.6');

	if (geo) {
		expect(geo.ll[0]).toBeGreaterThan(48);
		expect(geo.ll[0]).toBeLessThan(49);
		expect(geo.ll[1]).toBeGreaterThan(2);
		expect(geo.ll[1]).toBeLessThan(3);
	}
});

test('expect remote node to be far away', () => {
	const geo = geoip.lookup('1.1.128.50');

	if (geo) {
		expect(geo.ll[0]).toBeGreaterThan(16);
		expect(geo.ll[0]).toBeLessThan(517);
		expect(geo.ll[1]).toBeGreaterThan(101);
		expect(geo.ll[1]).toBeLessThan(102);
	}

});
