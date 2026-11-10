import { createHash, createPublicKey } from 'crypto';
import { Logger } from 'edumeet-common';

const logger = new Logger('publishedKeys');

// SHA-256 of the public key (SPKI, DER) of the key pair published with eduMeet: its public key
// was in this repository's example config and README, its private key in the management
// server's default config. Anyone can sign management tokens with it, so a room server that
// trusts it lets anyone join managed rooms as any user, room owners included. The same
// fingerprint is checked by the management server (src/auth/publishedKeys.ts there).
const PUBLISHED_KEY_FINGERPRINTS = new Set([
	'97e82e09ad25be80602e8146c04927a6d7a42c642250c9a72966b75024122177'
]);

const fingerprint = (key: string): string | undefined => {
	try {
		return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
			.digest('hex');
	} catch {
		return undefined;
	}
};

export const isPublishedKey = (key: unknown): boolean => {
	const print = typeof key === 'string' ? fingerprint(key) : undefined;

	return print !== undefined && PUBLISHED_KEY_FINGERPRINTS.has(print);
};

/**
 * The configured management keys this server may trust: not the published one, and only
 * readable public keys. Each one left out is logged as an error, because managed rooms do
 * not work until the operator configures the management server's own public key.
 */
export const usableSigningKeys = (keys: unknown[] = []): string[] => keys.filter((key, index): key is string => {
	if (isPublishedKey(key)) {
		logger.error('managementService.jwtPublicKeys[%d] is the public key published with eduMeet; anyone could sign tokens for it, so it is ignored. Configure the public key of your management server\'s authentication.secret (edumeet-docker: utils/run-me-first.sh)', index);

		return false;
	}
	if (typeof key !== 'string' || fingerprint(key) === undefined) {
		logger.error('managementService.jwtPublicKeys[%d] is not a readable public key and is ignored', index);

		return false;
	}

	return true;
});
