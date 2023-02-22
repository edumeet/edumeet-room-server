import { Logger } from 'edumeet-common';
import * as geoip from 'geoip-lite';

const logger = new Logger('GeoPosition');

interface GeoPositionOptions {
	address?: string,
	longitude?: number,
	latitude?: number
}

export default class GeoPosition {
	latitude: number;
	longitude: number;

	constructor({ address, longitude, latitude }: GeoPositionOptions) {

		if (address && (!longitude && !latitude)) {
			const geo = geoip.lookup(address);

			logger.debug('creating geoposition for ip', address);
			if (!geo) {
				throw Error('Geoposition not found');
			}

			this.latitude = geo.ll[0];
			this.longitude = geo.ll[1];
		} else if (!address && (longitude && latitude)) {
			this.latitude = latitude;
			this.longitude = longitude;
		} else {
			throw Error('construcor args must be either adress or longitude & latitude');
		}
	}

	public getDistance(positionToCompare: GeoPosition) {
		return this.calculateDistance(this, positionToCompare);
	}

	/**
	 * Implementation made available for general use at:
	 *http://www.movable-type.co.uk/scripts/latlong.html
	 */
	private calculateDistance(position1: GeoPosition, position2: GeoPosition): number {
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
		// Math.PI / 180
		if (isNaN(degrees)) {
			throw new Error('Must input valid number for degrees');
		}
	
		return degrees * 0.017453292519943295;
	}
}
