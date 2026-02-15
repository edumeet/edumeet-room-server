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
const verifyOptions: jwt.VerifyOptions =
	config.managementService?.jwtVerifyOptions || {};


export const verifyPeer = (token?: string): string | undefined => {
	logger.debug('verifyPeer()');

	if (!token) {
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

	return undefined;
};
