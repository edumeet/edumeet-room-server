import jwt, { JwtPayload } from 'jsonwebtoken';
import { getConfig } from '../Config';

const config = getConfig();
const signingKeys = config.managementService?.jwtPublicKeys || [];

export const verifyPeer = (token: string): string | undefined => {
	for (const key of signingKeys) {
		try {
			const { sub } = jwt.verify(token, key) as JwtPayload;

			return sub;
		// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
		} catch (err) {}
	}
};
