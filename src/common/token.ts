import config from '../../config/config.json';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Config } from '../Config';

export const actualConfig = config as Config;

const signingKeys = actualConfig.managementService?.jwtPublicKeys || [];

export const verifyPeer = (token: string): string | undefined => {
	for (const key of signingKeys) {
		try {
			const { sub } = jwt.verify(token, key) as JwtPayload;

			return sub;
		} catch (err) {}
	}
};