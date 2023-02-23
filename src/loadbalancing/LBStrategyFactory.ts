import { Logger } from 'edumeet-common';
import GeoStrategy from './GeoStrategy';
import LBStrategy, { LB_STRATEGIES } from './LBStrategy';
import StickyStrategy from './StickyStrategy';

const logger = new Logger('LBStrategyFactory');

/**
 * Create load balancing strategies.
 */
export default class LBStrategyFactory {
	private strategies: string[];

	constructor(strategies: string[]) {
		logger.debug('constructor() [strategies: %s]', strategies);
		if (!this.areValid(strategies)) {
			throw Error('Invalid load balancing strategies');
		}
		this.strategies = strategies;
	}

	private areValid(strategies: string[]): boolean {
		logger.debug('areValid() [strategies: %s]', strategies);
		
		return strategies.every((strategy) => 
			strategy == LB_STRATEGIES.GEO ||
            strategy == LB_STRATEGIES.STICKY
		);
	}

	public createStickyStrategy() {
		return new StickyStrategy();
	}

	public createStrategies() {
		const strategies = new Map<string, LBStrategy>();

		if (this.strategies.includes(LB_STRATEGIES.GEO)) {
			strategies.set(LB_STRATEGIES.GEO, new GeoStrategy());
		}
		
		return strategies;
	}
}