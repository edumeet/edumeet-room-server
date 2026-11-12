import 'jest';
import { RateLimiter } from '../../../src/common/rateLimiter';

describe('RateLimiter', () => {
	test('allows max within a window and refuses the next', () => {
		const limiter = new RateLimiter(3, 1000);

		expect([ 0, 1, 2, 3, 999 ].map((now) => limiter.take(1000 + now))).toEqual([ true, true, true, false, false ]);
	});

	test('allows again once the window has passed', () => {
		const limiter = new RateLimiter(1, 1000);

		expect(limiter.take(5000)).toBe(true);
		expect(limiter.take(5999)).toBe(false);
		expect(limiter.take(6000)).toBe(true);
		expect(limiter.take(6001)).toBe(false);
	});
});

describe('ByteBudget', () => {
	test('gives its capacity at once, then refills by perSecond up to the capacity', async () => {
		const { ByteBudget } = await import('../../../src/common/rateLimiter');
		const budget = new ByteBudget(1000, 100);

		expect(budget.take(1000, 0)).toBe(true);
		expect(budget.take(1, 0)).toBe(false);
		expect(budget.take(500, 5_000)).toBe(true);
		expect(budget.take(1, 5_000)).toBe(false);
		// a long pause refills to the capacity, not beyond
		expect(budget.take(1000, 1_000_000)).toBe(true);
		expect(budget.take(1, 1_000_000)).toBe(false);
	});
});
