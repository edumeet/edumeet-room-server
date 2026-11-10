import 'jest';
import fs from 'fs';
import path from 'path';
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { isPublishedKey, usableSigningKeys } from '../../../src/common/publishedKeys';

// The public key that was shipped in config.example.json and the README; its private key is
// published too, so anyone can sign tokens for it.
const published = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'published-management-key.pub.pem'), 'utf8');
const own = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('management signing keys', () => {
	it('recognises the published key in any form', () => {
		expect(isPublishedKey(published)).toBe(true);
		expect(isPublishedKey(createPublicKey(published).export({ type: 'pkcs1', format: 'pem' })
			.toString())).toBe(true);
		expect(isPublishedKey(own)).toBe(false);
	});

	it('trusts only the operator\'s own readable keys', () => {
		expect(usableSigningKeys([ published, own, 'REPLACE_WITH_THE_PUBLIC_KEY_OF_YOUR_MANAGEMENT_SERVER' ])).toEqual([ own ]);
		expect(usableSigningKeys(undefined)).toEqual([]);
	});
});
