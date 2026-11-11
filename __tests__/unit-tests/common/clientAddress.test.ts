import { resolveClientIp } from '../../../src/common/clientAddress';
import * as ConfigModule from '../../../src/Config';

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

describe('a forwarded address', () => {
	afterEach(() => jest.restoreAllMocks());

	test('is ignored from a client that connects directly from a public address', () => {
		expect(resolveClientIp({ address: '198.51.100.9', forwardedFor: '203.0.113.7' })).toBe('198.51.100.9');
		expect(resolveClientIp({ address: '::ffff:198.51.100.9', forwardedFor: '203.0.113.7' })).toBe('198.51.100.9');
		expect(resolveClientIp({ address: '2001:db8::5', forwardedFor: '203.0.113.7' })).toBe('2001:db8::5');
	});

	test('is believed from the proxy on the Docker network, also as an IPv4-mapped address', () => {
		expect(resolveClientIp({ address: '::ffff:172.18.0.3', forwardedFor: '203.0.113.7' })).toBe('203.0.113.7');
		expect(resolveClientIp({ address: '127.0.0.1', forwardedFor: '203.0.113.7' })).toBe('203.0.113.7');
	});

	test('follows the configured trustedProxies instead of the default', () => {
		jest.spyOn(ConfigModule, 'getConfig').mockReturnValue({ ...ConfigModule.getConfig(), trustedProxies: [ '198.51.100.9', '2001:db8::/32' ] });

		expect(resolveClientIp({ address: '198.51.100.9', forwardedFor: '203.0.113.7' })).toBe('203.0.113.7');
		expect(resolveClientIp({ address: '2001:db8::5', forwardedFor: '203.0.113.7' })).toBe('203.0.113.7');
		expect(resolveClientIp({ address: '10.0.0.2', forwardedFor: '203.0.113.7' })).toBe('10.0.0.2');
	});
});
