import { getConfig } from '../Config';

export const UNMAPPED_REGION = 'OTHER';

export const countryToRegion = (cc?: string): string => {
	if (!cc) return UNMAPPED_REGION;

	const map = getConfig().countryToRegion ?? {};

	return map[cc.toUpperCase()] ?? UNMAPPED_REGION;
};
