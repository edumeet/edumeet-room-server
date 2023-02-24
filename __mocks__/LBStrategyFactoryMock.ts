import StickyStrategy from '../src/loadbalancing/StickyStrategy';
import LBStrategy from '../src/loadbalancing/LBStrategy';

export default class LBStrategyFactoryMock {
	sticky = { getCandidates: () => { return []; } } as unknown as StickyStrategy;
	strategies = new Map<string, LBStrategy>();

	constructor(sticky?: StickyStrategy, strategies?: Map<string, LBStrategy>) {
		if (sticky)	this.sticky = sticky;
		if (strategies) this.strategies = strategies;
	}

	createStickyStrategy = () => { return this.sticky; };
	createStrategies = () => { return this.strategies; };
}