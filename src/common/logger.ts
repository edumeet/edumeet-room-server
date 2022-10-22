import debug from 'debug';

export class Logger {
	readonly #debug: debug.Debugger;
	readonly #warn: debug.Debugger;
	readonly #error: debug.Debugger;

	constructor(prefix?: string) {
		if (prefix) {
			this.#debug = debug(`${process.title}:DEBUG:${prefix}`);
			this.#warn = debug(`${process.title}:WARN:${prefix}`);
			this.#error = debug(`${process.title}:ERROR:${prefix}`);
		} else {
			this.#debug = debug(`${process.title}:DEBUG`);
			this.#warn = debug(`${process.title}:WARN`);
			this.#error = debug(`${process.title}:ERROR`);
		}

		/* eslint-disable no-console */
		this.#debug.log = console.info.bind(console);
		this.#warn.log = console.warn.bind(console);
		this.#error.log = console.error.bind(console);
		/* eslint-enable no-console */
	}

	get debug(): debug.Debugger {
		return this.#debug;
	}

	get warn(): debug.Debugger {
		return this.#warn;
	}

	get error(): debug.Debugger {
		return this.#error;
	}
}