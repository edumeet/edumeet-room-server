import { EventEmitter } from 'events';
import { InboundNotification, InboundRequest, Logger, Pipeline, skipIfClosed, SocketMessage, SocketTimeoutError } from 'edumeet-common';
import { io, Socket } from 'socket.io-client';
import { safePromise } from '../common/safePromise';

const logger = new Logger('MediaNodeConnection');

interface MediaNodeConnectionOptions {
	url: string,
	timeout: number,
}

interface ClientServerEvents {
	/* eslint-disable no-unused-vars */
	notification: (notification: SocketMessage) => void;
	request: (request: SocketMessage, result: (
		serverError: unknown,
		responseData: unknown) => void
	) => void;
	/* eslint-enable no-unused-vars */
}

interface ServerClientEvents {
	/* eslint-disable no-unused-vars */
	notification: (notification: SocketMessage) => void;
	request: (request: SocketMessage, result: (
		timeout: Error | null,
		serverError: unknown,
		responseData: unknown) => void
	) => void;
	/* eslint-enable no-unused-vars */
}
export interface MediaNodeConnectionContext {
	message: SocketMessage;
	response: Record<string, unknown>;
	handled: boolean;
}

/* eslint-disable no-unused-vars */
export declare interface MediaNodeConnection {
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
	on(event: 'notification', listener: InboundNotification): this;
	on(event: 'request', listener: InboundRequest): this;
	on(event: 'load', listener: (load: number) => void): this;
	on(event: 'draining', listener: () => void): this;
}
/* eslint-enable no-unused-vars */

export class MediaNodeConnection extends EventEmitter {
	public closed = false;
	public pipeline = Pipeline<MediaNodeConnectionContext>();

	#resolveReadyTimeoutHandle: NodeJS.Timeout | undefined;

	public resolveReady!: () => void;
	// eslint-disable-next-line no-unused-vars
	public rejectReady!: (error: MediaNodeError) => void;
	public ready = safePromise<void, MediaNodeError>(new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	}));

	#socket!: Socket<ClientServerEvents, ServerClientEvents>;
	#timeout;

	constructor({ url, timeout = 3000 }: MediaNodeConnectionOptions) {
		logger.debug('constructor() [url: %s, timeout: %s]', url, timeout);
		super();

		this.#timeout = timeout;

		try {
			this.#socket = io(url, {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				transports: [ 'websocket', 'polling' ],
				rejectUnauthorized: false,
				closeOnBeforeunload: false,
			});

			this.#handleSocket();
		} catch (error) {
			logger.error({ err: error }, 'constructor() [error: %o]');
			
			this.rejectReady(new ConnectionError('Failed to connect to media node'));
			this.close();
		}
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close()');

		this.closed = true;

		if (this.#socket.connected) this.#socket.disconnect();

		this.#socket.removeAllListeners();
		this.#socket.disconnect();

		clearTimeout(this.#resolveReadyTimeoutHandle);
		this.#resolveReadyTimeoutHandle = undefined;

		this.emit('close', remoteClose);
	}

	#handleSocket(): void {
		this.#resolveReadyTimeoutHandle = setTimeout(() => this.rejectReady(new TimeoutError('connection timed out')), this.#timeout);

		this.#socket.on('notification', async (notification) => {
			logger.debug('"notification" recieved [notification: %o]', notification);

			const dataLoad = notification.data?.load;

			if (typeof dataLoad === 'number') this.emit('load', dataLoad);

			if (notification.method === 'mediaNodeReady') {
				clearTimeout(this.#resolveReadyTimeoutHandle);

				return this.resolveReady();
			}

			if (notification.method === 'mediaNodeDrain') {
				this.rejectReady(new DrainingError('Media node is draining'));

				return this.emit('draining');
			}

			if (notification.method === 'mediaNodeStats') {
				// Do nothing: handled above by dataLoad

				return;
			}

			try {
				const context = {
					message: notification,
					response: {},
					handled: false,
				} as MediaNodeConnectionContext;

				await this.pipeline.execute(context);

				if (!context.handled)
					throw new Error(`no middleware handled the notification [method: ${notification.method}]`);
			} catch (error) {
				logger.error({ err: error }, 'notification() [error: %o]');
			}
		});

		this.#socket.on('request', async (request, result) => {
			logger.debug('"request" event [request: %o]', request);
			try {
				const dataLoad = request.data?.load;

				if (typeof dataLoad === 'number') this.emit('load', dataLoad);

				const context = {
					message: request,
					response: {},
					handled: false,
				} as MediaNodeConnectionContext;

				await this.pipeline.execute(context);

				if (context.handled)
					result(null, context.response);
				else {
					logger.debug('request() unhandled request [method: %s]', request.method);
					result('Server error', null);
				}
			} catch (error) {
				logger.error({ err: error }, 'request() [error: %o]');

				result('Server error', null);
			}
		});

		this.#socket.once('disconnect', () => {
			logger.debug('socket disconnected');
			this.close(true);
		});

		this.#socket.on('connect', () => logger.debug('handleSocket() connected'));
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('notify() [method: %s]', notification.method);

		this.#socket.emit('notification', notification);
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [method: %s]', request.method);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const response: any = await this.#sendRequestOnWire(request);

		const { load } = response;

		if (typeof load === 'number') this.emit('load', load);

		return response;
	}

	#sendRequestOnWire(socketMessage: SocketMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.#socket) {
				reject('No socket connection');
			} else {
				this.#socket.timeout(this.#timeout).emit('request', socketMessage, (timeout, serverError, response) => {
					if (timeout) reject(new SocketTimeoutError('Request timed out'));
					else if (serverError) reject(serverError);
					else resolve(response);
				});
			}
		});
	}
}

export class ConnectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConnectionError';
	}
}

export class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

export class DrainingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DrainingError';
	}
}

export type MediaNodeError = ConnectionError | TimeoutError | DrainingError;
