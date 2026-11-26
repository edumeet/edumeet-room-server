import jwt, {
	JwtPayload,
	JsonWebTokenError,
	TokenExpiredError,
	NotBeforeError
} from 'jsonwebtoken';
import { getConfig } from '../Config';
import { Logger } from 'edumeet-common';
import { usableSigningKeys } from './publishedKeys';

const logger = new Logger('token');

const config = getConfig();
// Never the key pair published with eduMeet (see publishedKeys.ts).
const signingKeys = usableSigningKeys(config.managementService?.jwtPublicKeys);

// tenantId: the tenant of the address the token is used at. The management server names the
// user's tenant in the token (null for a user without one, a super admin). A token of another
// tenant, or one without the claim (issued before tokens named their tenant), counts as none.
export const verifyPeer = (token: string | undefined, tenantId: number): string | undefined => {
	logger.debug('verifyPeer()');

	if (!token) {
		logger.debug('verifyPeer() - not token given');

		return undefined;
	}

	if (signingKeys.length === 0) {
		logger.debug('verifyPeer() - no keys configured');

		return undefined;
	}

	for (const key of signingKeys) {
		try {
			const payload = jwt.verify(token, key) as JwtPayload;
			const sub = payload?.sub;

			if (typeof sub !== 'string' || sub.length === 0) {
				logger.debug({ sub }, 'verifyPeer() - invalid sub');

				return undefined;
			}

			if (payload.tenantId !== null && String(payload.tenantId) !== String(tenantId)) {
				logger.debug({ sub, tokenTenantId: payload.tenantId, tenantId }, 'verifyPeer() - token of another tenant or without one');

				return undefined;
			}

			logger.debug({ sub }, 'verifyPeer() - OK');

			return sub;
		} catch (err) {
			if (err instanceof TokenExpiredError) {
				logger.debug(
					{ message: err.message, expiredAt: err.expiredAt },
					'verifyPeer() - expired'
				);

				continue;
			}

			if (err instanceof NotBeforeError) {
				logger.debug(
					{ message: err.message, date: err.date },
					'verifyPeer() - not active'
				);

				continue;
			}

			if (err instanceof JsonWebTokenError) {
				logger.debug(
					{ message: err.message },
					'verifyPeer() - invalid'
				);

				continue;
			}

			logger.debug({ err }, 'verifyPeer() - error');
		}
	}

	logger.debug('verifyPeer() - token verification failed');

	return undefined;
};
