import { GeoStrategy } from './GeoStrategy';
import { LBStrategy, LB_STRATEGIES } from './LBStrategy';
import { StickyStrategy } from './StickyStrategy';

export class LBStrategyFactory {
	private strategies: string[];

	constructor(strategies: string[]) {
		if (this.areInvalid(strategies)) {
			throw Error('Invalid load balancing strategies');
		}
		this.strategies = strategies;
	}

	private areInvalid(strategies: string[]): boolean {
		strategies.forEach((strategy) => {
			if (strategy == LB_STRATEGIES.GEO ||
                strategy == LB_STRATEGIES.STICKY) {
				return false;
			} 		
		});
		
		return true;
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