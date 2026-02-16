import jwt, {
	JwtPayload,
	JsonWebTokenError,
	TokenExpiredError,
	NotBeforeError
} from 'jsonwebtoken';
import { getConfig } from '../Config';
import { Logger } from 'edumeet-common';

const logger = new Logger('token');

const config = getConfig();
const signingKeys = config.managementService?.jwtPublicKeys || [];
const raw = config.managementService?.jwtVerifyOptions;

const toAudience = (
	aud?: string | string[]
): jwt.VerifyOptions['audience'] => {
	if (!aud) {
		return undefined;
	}

	if (typeof aud === 'string') {
		return aud;
	}

	if (aud.length === 0) {
		return undefined;
	}

	return aud as [string, ...string[]];
};

const toIssuer = (
	iss?: string | string[]
): jwt.VerifyOptions['issuer'] => {
	if (!iss) {
		return undefined;
	}

	if (typeof iss === 'string') {
		return iss;
	}

	if (iss.length === 0) {
		return undefined;
	}

	return iss as [string, ...string[]];
};

const verifyOptions: jwt.VerifyOptions = {
	audience: toAudience(raw?.audience),
	issuer: toIssuer(raw?.issuer),
	algorithms: raw?.algorithms
};

export const verifyPeer = (token?: string): string | undefined => {
	logger.debug('verifyPeer()');

	if (!token) {
		logger.debug('verifyPeer() - not token given');

		return undefined;
	}

	if (signingKeys.length === 0){
		logger.debug('verifyPeer() - no keys configured');

		return undefined;
	}

	for (const key of signingKeys) {
		try {
			const payload = jwt.verify(token, key, verifyOptions) as JwtPayload;

			const sub = payload?.sub;

			if (typeof sub !== 'string' || sub.length === 0) {
				logger.debug({ sub }, 'verifyPeer() - invalid sub');

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
