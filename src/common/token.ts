import jwt, { JwtPayload } from 'jsonwebtoken';
import { actualConfig } from '../server';

const signingKeys = actualConfig.managementService?.jwtPublicKeys || [];

export const verifyPeer = (token: string): string | undefined => {
	for (const key of signingKeys) {
		try {
			const { sub } = jwt.verify(token, key) as JwtPayload;

			return sub;
		} catch (err) {}
	}
};