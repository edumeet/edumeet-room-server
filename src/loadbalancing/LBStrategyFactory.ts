import { KDPoint } from 'edumeet-common';
import GeoStrategy from './GeoStrategy';
import LoadStrategy from './LoadStrategy';
import StickyStrategy from './StickyStrategy';

/**
 * Create load balancing strategies.
 */
export default class LBStrategyFactory {
	public createStickyStrategy() {
		return new StickyStrategy();
	}

	public createLoadStrategy() {
		return new LoadStrategy();
	}

	public createGeoStrategy(defaultClientPosition: KDPoint) {
		return new GeoStrategy(defaultClientPosition);
	}
}