import { randomUUID } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';

export const signingkey = randomUUID();

export const verifyPeer = (peerId: string, token: string): boolean => {
	try {
		const decoded = jwt.verify(token, signingkey) as JwtPayload;

		return decoded.id === peerId;
	} catch (e) {}

	return false;
};