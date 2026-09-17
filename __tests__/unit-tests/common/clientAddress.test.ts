import { resolveClientIp } from '../../../src/common/clientAddress';

describe('resolveClientIp', () => {
	test('takes the first forwarded entry when the proxy set one', () => {
		expect(resolveClientIp({ address: '10.0.0.2', forwardedFor: '203.0.113.7' })).toBe('203.0.113.7');
		expect(resolveClientIp({ address: '10.0.0.2', forwardedFor: '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7');
		expect(resolveClientIp({ address: '10.0.0.2', forwardedFor: [ '203.0.113.7', '10.0.0.1' ] })).toBe('203.0.113.7');
	});

	test('falls back to the socket address', () => {
		expect(resolveClientIp({ address: '10.0.0.2' })).toBe('10.0.0.2');
		expect(resolveClientIp({ address: '10.0.0.2', forwardedFor: '' })).toBe('10.0.0.2');
		expect(resolveClientIp({ address: '' })).toBeUndefined();
	});
});
