import jwt, { JwtPayload } from 'jsonwebtoken';
import { getConfig } from '../Config';

const config = getConfig();
const signingKeys = config.managementService?.jwtPublicKeys || [];

export type VerifyPeerResult =
	| { ok: true; managedId: string; expiresAtMs?: number }
	| { ok: false; reason: 'expired' | 'invalid' };

export const verifyPeer = (token: string): VerifyPeerResult => {
	let sawExpired = false;

	for (const key of signingKeys) {
		try {
			const payload = jwt.verify(token, key) as JwtPayload;
			const sub = payload?.sub;

			if (typeof sub !== 'string' || !sub)
				return { ok: false, reason: 'invalid' };

			const exp = payload?.exp;
			const expiresAtMs = typeof exp === 'number' ? exp * 1000 : undefined;

			return { ok: true, managedId: sub, expiresAtMs };
		} catch (error: unknown) {
			if (error instanceof jwt.TokenExpiredError) {
				sawExpired = true;
			}
		}
	}

	return { ok: false, reason: sawExpired ? 'expired' : 'invalid' };
};
