import { KDPoint } from 'edumeet-common';
import LoadStrategy from '../../../src/loadbalancing/LoadStrategy';

const point1 = { appData: { mediaNode: { load: 0 } } } as unknown as KDPoint;
const point2 = { appData: { mediaNode: { load: 0.2 } } } as unknown as KDPoint;
const point3 = { appData: { mediaNode: { load: 0.4 } } } as unknown as KDPoint;
const point4 = { appData: { mediaNode: { load: 0.86 } } } as unknown as KDPoint;
const point5 = { appData: { mediaNode: { load: 0.9 } } } as unknown as KDPoint;

test('Should use other media-node on high load', () => {

	const sut = new LoadStrategy();

	const candidates = sut.filterOnLoad([ point4, point2 ]);

	expect(candidates[0]).toBe(point2);
	expect(candidates.length).toBe(1);
});

test('Should return sorted on load', () => {
	const sut = new LoadStrategy();

	const candidates = sut.filterOnLoad([ point3, point2, point1 ]);

	expect(candidates[0]).toBe(point1);
	expect(candidates[1]).toBe(point2);
	expect(candidates[2]).toBe(point3);
	expect(candidates.length).toBe(3);
});

test('Should filter out high load candidates', () => {
	const sut = new LoadStrategy();

	const candidates = sut.filterOnLoad([ point5, point4, point2 ]);

	expect(candidates[0]).toBe(point2);
	expect(candidates.length).toBe(1);
});

test('Should return empty array on all node high load ', () => {
	const sut = new LoadStrategy();

	const candidates = sut.filterOnLoad([ point4, point5 ]);

	expect(candidates.length).toBe(0);
});