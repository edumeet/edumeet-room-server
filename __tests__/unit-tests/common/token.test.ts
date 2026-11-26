import 'jest';
import jwt from 'jsonwebtoken';

// A key pair of the test's own, as the management server's signing key.
jest.mock('../../../src/Config', () => {
	const { generateKeyPairSync } = jest.requireActual('crypto');
	const keys = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});

	return {
		getConfig: () => ({ managementService: { jwtPublicKeys: [ keys.publicKey ] } }),
		mockPrivateKey: keys.privateKey
	};
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyPeer } = require('../../../src/common/token');
const { mockPrivateKey } = jest.requireMock('../../../src/Config');

const TENANT = 7;
const token = (claims: Record<string, unknown>) => jwt.sign({ sub: '42', ...claims }, mockPrivateKey, { algorithm: 'RS256', expiresIn: '1h' });

describe('verifyPeer() and the tenant of the token', () => {
	test('takes a token of the tenant of the address', () => {
		expect(verifyPeer(token({ tenantId: TENANT }), TENANT)).toBe('42');
	});

	test('refuses a token of another tenant', () => {
		expect(verifyPeer(token({ tenantId: 8 }), TENANT)).toBeUndefined();
	});

	test('refuses a token without a tenant claim, issued before tokens named their tenant', () => {
		expect(verifyPeer(token({}), TENANT)).toBeUndefined();
	});

	test('takes the token of a user without a tenant (super admin) at every tenant', () => {
		expect(verifyPeer(token({ tenantId: null }), TENANT)).toBe('42');
		expect(verifyPeer(token({ tenantId: null }), 0)).toBe('42');
	});

	test('compares the tenant as a value, whether number or string', () => {
		expect(verifyPeer(token({ tenantId: String(TENANT) }), TENANT)).toBe('42');
	});

	test('a token of a tenant counts as none at an address without a tenant', () => {
		expect(verifyPeer(token({ tenantId: TENANT }), 0)).toBeUndefined();
	});

	test('still refuses no token, a wrong signature and an expired token', () => {
		expect(verifyPeer(undefined, TENANT)).toBeUndefined();
		expect(verifyPeer(`${token({ tenantId: TENANT })}x`, TENANT)).toBeUndefined();
		expect(verifyPeer(jwt.sign({ sub: '42', tenantId: TENANT, exp: Math.floor(Date.now() / 1000) - 60 }, mockPrivateKey, { algorithm: 'RS256' }), TENANT)).toBeUndefined();
	});
});
