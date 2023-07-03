import { EventEmitter } from 'events';
import { InboundNotification, InboundRequest, Logger, Pipeline, skipIfClosed, SocketMessage, SocketTimeoutError } from 'edumeet-common';
import { io, Socket } from 'socket.io-client';

const logger = new Logger('MediaNodeConnection');

interface MediaNodeConnectionOptions {
	url: string,
	timeout: number,
}

interface ClientServerEvents {
	/* eslint-disable no-unused-vars */
	notification: (notification: SocketMessage) => void;
	request: (request: SocketMessage, result: (
		serverError: unknown | null,
		responseData: unknown) => void
	) => void;
	/* eslint-enable no-unused-vars */
}

interface ServerClientEvents {
	/* eslint-disable no-unused-vars */
	notification: (notification: SocketMessage) => void;
	request: (request: SocketMessage, result: (
		timeout: Error | null,
		serverError: unknown | null,
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
	on(event: 'close', listener: () => void): this;
	on(event: 'notification', listener: InboundNotification): this;
	on(event: 'request', listener: InboundRequest): this;
	on(event: 'load', listener: (load: number) => void): this;
}
/* eslint-enable no-unused-vars */

export class MediaNodeConnection extends EventEmitter {
	public closed = false;
	public pipeline = Pipeline<MediaNodeConnectionContext>();
	
	public resolveReady!: () => void;
	// eslint-disable-next-line no-unused-vars
	public rejectReady!: (error: unknown) => void;
	#resolveReadyTimeoutHandle: NodeJS.Timeout | undefined;
	public ready = new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	});
	
	#socket: Socket<ClientServerEvents, ServerClientEvents>;
	#timeout;

	constructor({ url, timeout = 3000 }: MediaNodeConnectionOptions) {
		logger.debug('constructor() [url: %s, timeout: %s]', url, timeout);
		super();

		this.#timeout = timeout;
		this.#socket = io(url, {
			transports: [ 'websocket', 'polling' ],
			rejectUnauthorized: false,
			closeOnBeforeunload: false,
		});

		this.#handleSocket();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close()');
		this.closed = true;
		if (this.#socket.connected) this.#socket.disconnect();
		this.#socket.removeAllListeners();
		this.emit('close');
		this.#socket.off();
	}

	#handleSocket(): void {
		this.#resolveReadyTimeoutHandle = setTimeout(() => { this.rejectReady('Timeout waiting for media-node connection'); }, this.#timeout);
		
		this.#socket.on('notification', async (notification) => {
			this.emit('load', notification.data?.load);

			if (notification.method === 'mediaNodeReady') {
				clearTimeout(this.#resolveReadyTimeoutHandle);
				
				return this.resolveReady(); 
			}

			try {
				const context = {
					message: notification,
					response: {},
					handled: false,
				} as MediaNodeConnectionContext;

				await this.pipeline.execute(context);

				if (!context.handled)
					throw new Error('no middleware handled the notification');
			} catch (error) {
				logger.error('notification() [error: %o]', error);
			}
		});

		this.#socket.on('request', async (request, result) => {
			logger.debug('"request" event [request: %o]', request);
			try {
				this.emit('load', request.data?.load);
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
				logger.error('request() [error: %o]', error);

				result('Server error', null);
			}
		});

		this.#socket.once('disconnect', () => {
			logger.debug('socket disconnected');
			this.close(); 
		});
		this.#socket.on('connect', () => {
			logger.debug('handleSocket() connected');
		});
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

		this.emit('load', response?.load);
			
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