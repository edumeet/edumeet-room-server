import { Logger } from 'edumeet-common';
import * as geoip from 'geoip-lite';

const logger = new Logger('GeoPosition');

export interface GeoPositionOptions {
	latitude: number
	longitude: number,
}

export default class GeoPosition {
	private latitude: number;
	private longitude: number;

	constructor({ latitude, longitude }: GeoPositionOptions) {
		logger.debug('constructor() [latitude: %s, longitute: %s]', latitude, longitude);
		if (!longitude || !latitude) {
			throw Error('latitude or longitude missing');
		}
		this.latitude = latitude;
		this.longitude = longitude;
	}

	public static create({ address }: { address: string }): GeoPosition {
		logger.debug('create() [address: %s]', address);
		const geo = geoip.lookup(address);

		if (!geo) {
			throw Error('Geoposition not found');
		} else {
			const [ latitude, longitude ] = geo.ll;
			
			return new GeoPosition({ latitude, longitude });
		}
	}

	public getDistance(positionToCompare: GeoPosition) {
		logger.debug('getDistance() [positionToCompare: %s]', positionToCompare);
		
		return this.calculateDistance(this, positionToCompare);
	}

	/**
	 * Implementation made available for general use at:
	 *http://www.movable-type.co.uk/scripts/latlong.html
	 */
	private calculateDistance(position1: GeoPosition, position2: GeoPosition): number {
		logger.debug('calculateDistance() [position1: %s, position2: %s]', position1, position2);
		const sine = (num: number) => Math.sin(num / 2);
		const cosine = (num: number) => Math.cos(num);
	
		const radius = 6371;
		const φ1 = this.degreeToRadians(position1.latitude);
		const λ1 = this.degreeToRadians(position1.longitude);
		const φ2 = this.degreeToRadians(position2.latitude);
		const λ2 = this.degreeToRadians(position2.longitude);
		const Δφ = φ2 - φ1;
		const Δλ = λ2 - λ1;
	
		const a = (sine(Δφ) * sine(Δφ)) + (cosine(φ1) * cosine(φ2) * Math.pow(sine(Δλ), 2));
		
		return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * radius;
	}

	private degreeToRadians(degrees = 0): number {
		if (isNaN(degrees)) {
			throw new Error('Must input valid number for degrees');
		}
	
		return degrees * 0.017453292519943295;
	}
}
