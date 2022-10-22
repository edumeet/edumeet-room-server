import { Logger } from './logger';

let logger: Logger;

export class LoggerFactory {
	public static getInstance(): Logger {
		if (!logger) {
			logger = new Logger();
		}

		return logger;
	}
}