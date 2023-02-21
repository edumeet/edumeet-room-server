export default class LBStrategyFactoryMock {
	sticky = { getCandidates: () => { return []; } };
	strategies = new Map<string, any>();

	constructor(sticky?: any, strategies?: any) {
		if (sticky)	this.sticky = sticky;
		if (strategies) this.strategies = strategies;
	}

	createStickyStrategy = () => { return this.sticky; };
	createStrategies = () => { return this.strategies; };
}