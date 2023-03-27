import StickyStrategy from '../src/loadbalancing/StickyStrategy';
import LoadStrategy from '../src/loadbalancing/LoadStrategy';
import GeoStrategy from '../src/loadbalancing/GeoStrategy';

export default class LBStrategyFactoryMock {
	sticky = { getCandidates: () => { return []; } } as unknown as StickyStrategy;
	load = { filterOnLoad: () => { return []; } } as unknown as LoadStrategy;
	geo = { getClientPosition: jest.fn(),
		filterOnThreshold: () => { return []; } } as unknown as GeoStrategy;

	constructor(
		sticky?: StickyStrategy,
		load?: LoadStrategy,
		geo?: GeoStrategy
	) {
		if (sticky)	this.sticky = sticky;
		if (geo) this.geo = geo;
		if (load) this.load = load;
	}

	createStickyStrategy = () => { return this.sticky; };
	createLoadStrategy = () => { return this.load; };
	createGeoStrategy = () => { return this.geo; };
}