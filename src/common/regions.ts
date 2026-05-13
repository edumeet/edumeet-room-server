import { getConfig } from '../Config';

export const UNMAPPED_REGION = 'OTHER';

/**
 * Resolves a country code to the list of region labels it belongs to.
 * Each country may belong to one or more regions (e.g. DE → ['EEA', 'DACH']),
 * letting tenants restrict by either the broad bucket (EEA) or the narrower
 * one (DACH) without duplicating media-node configuration.
 *
 * The config tolerates `string` for the common single-region case and
 * `string[]` for multi-region; both shapes are normalised here. Unmapped
 * countries (and an absent `cc`) resolve to a single-element list with the
 * internal `UNMAPPED_REGION` sentinel.
 */
export const countryToRegions = (cc?: string): string[] => {
	if (!cc) return [ UNMAPPED_REGION ];

	const map = getConfig().countryToRegion ?? {};
	const value = map[cc.toUpperCase()];

	if (!value) return [ UNMAPPED_REGION ];
	if (Array.isArray(value)) {
		return value.length > 0 ? value : [ UNMAPPED_REGION ];
	}

	return [ value ];
};
