import StickyStrategy from '../src/loadbalancing/StickyStrategy';
import LBStrategy from '../src/loadbalancing/LBStrategy';
import LoadStrategy from '../src/loadbalancing/LoadStrategy';

export default class LBStrategyFactoryMock {
	sticky = { getCandidates: () => { return []; } } as unknown as StickyStrategy;
	load = { getCandidates: () => { return []; } } as unknown as LoadStrategy;
	strategies = new Map<string, LBStrategy>();

	constructor(
		sticky?: StickyStrategy,
		load?: LoadStrategy,
		strategies?: Map<string, LBStrategy>
	) {
		if (sticky)	this.sticky = sticky;
		if (strategies) this.strategies = strategies;
		if (load) this.load = load;
	}

	createStickyStrategy = () => { return this.sticky; };
	createLoadStrategy = () => { return this.load; };
	createStrategies = () => { return this.strategies; };
}