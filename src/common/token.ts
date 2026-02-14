import jwt, { JwtPayload } from 'jsonwebtoken';
import { getConfig } from '../Config';
import { Logger } from 'edumeet-common';

const logger = new Logger('token');

const config = getConfig();
const signingKeys = config.managementService?.jwtPublicKeys || [];

export const verifyPeer = (token: string): string | undefined => {
	logger.debug({ token: token, signingKeys: signingKeys }, 'verifyPeer() - init params');

	for (const key of signingKeys) {
		try {
			const { sub } = jwt.verify(token, key) as JwtPayload;

			logger.debug({ sub }, 'verifyPeer() - OK');

			return sub;
		// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
		} catch (err) {
			logger.debug({ err }, 'verifyPeer() - error');
		}
	}
};
