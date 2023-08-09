import { Logger } from 'edumeet-common';
import { ClientRequest } from 'http';
import https from 'https';

const logger = new Logger('MediaNodeHealth');

export const ConnectionStatus = Object.freeze({
	ERROR: 'error',
	RETRYING: 'retrying',
	OK: 'ok',
	CLOSED: 'closed'
});

export type ConnectionStatus = typeof ConnectionStatus[keyof typeof ConnectionStatus]

export interface MediaNodeHealthOptions {
        hostname: string,
        port: number
        }

export default class MediaNodeHealth {
	load: number;
	#timeoutHandle?: NodeJS.Timeout;
	#retryRequests;
	#connectionStatus: ConnectionStatus;
	#backoffIntervals = [
		5000, 5000, 5000,
		30000, 30000, 30000,
		300000, 300000, 300000,
		900000, 900000, 900000
	];
	#retryCount = 0;
	hostname;
	port;

	constructor({ hostname, port }: MediaNodeHealthOptions) {
		this.load = 0;
		this.#retryRequests = new Map<number, ClientRequest>();
		this.#connectionStatus = ConnectionStatus.OK;
		this.hostname = hostname;
		this.port = port;
	}

	public close() {
		this.#retryRequests.forEach((req) => req.destroy());
		clearTimeout(this.#timeoutHandle);
		this.#connectionStatus = ConnectionStatus.CLOSED;
	}

	public getConnectionStatus() {
		return this.#connectionStatus;
	}
    
	public async retryConnection(): Promise<void> {
		logger.debug('retryConnection()');
		if (this.#connectionStatus === ConnectionStatus.RETRYING) return;
		this.#connectionStatus = ConnectionStatus.RETRYING;
		this.#retryCount = 0;

		do {
			try {
				const timeout = this.#backoffIntervals[this.#retryCount];

				await this.#retryConnection(timeout, this.#retryCount);
			} catch (error) {
				logger.error(error);
				this.#retryCount++;
			} 
		} while (this.#retryCount < this.#backoffIntervals.length 
				&& this.#connectionStatus === ConnectionStatus.RETRYING);
		
		if (this.#retryCount === this.#backoffIntervals.length) {
			// We ran out of backoff intervals. MediaNode will be left in error state.
			this.#connectionStatus = ConnectionStatus.ERROR;
		}
	}

	async #retryConnection(timeout: number, retryCount: number) {
		logger.debug('#retryConnection() [timeout: %s, retryCount: %s]', timeout, retryCount);
		
		return new Promise<void>((resolve, reject) => {
			this.#timeoutHandle = setTimeout(() => reject(new Error('Timeout'))
				, timeout
			);
			const req = https.get({
				hostname: this.hostname,
				port: this.port,
				path: '/health',
				timeout: timeout },
			(resp) => {
				logger.debug('#retryConnection() Got response from MediaNode [statuscode: %s]', resp.statusCode);
				if (resp.statusCode === 200) {
					this.#connectionStatus = ConnectionStatus.OK; 
					resolve();
				}
				reject(new Error('Status code was not 200.'));
			});

			req.on('error', (error) => {
				logger.error(error);
				req.destroy(); 
				this.#retryRequests.delete(retryCount);
			});
			req.on('timeout', () => {
				reject(new Error('Timeout'));
				req.destroy();
				this.#retryRequests.delete(retryCount);
			});

			this.#retryRequests.set(retryCount, req);
		});

	}

}