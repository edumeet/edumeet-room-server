import jwt, { JwtPayload } from 'jsonwebtoken';
import { getConfig } from '../Config';
import { Logger } from 'edumeet-common';

const logger = new Logger('token');

const config = getConfig();
const signingKeys = config.managementService?.jwtPublicKeys || [];

export const verifyPeer = (token: string): string | undefined => {
	logger.debug('verifyPeer()');

	for (const key of signingKeys) {
		try {
			const { sub } = jwt.verify(token, key) as JwtPayload;

			logger.debug({ sub }, 'verifyPeer() - OK');

			return sub;

		} catch (err) {
			logger.debug({ err }, 'verifyPeer() - error');
		}
	}
};
