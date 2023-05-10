import { BaseConnection, Logger, SocketMessage, SocketTimeoutError, skipIfClosed } from 'edumeet-common';
import { io, Socket } from 'socket.io-client';

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

const logger = new Logger('IONodeConnection');

interface IONodeConnectionOptions {
	url: string;
    timeout?: number
}

export class IONodeConnection extends BaseConnection {
	private timeout;

	public static create({ url, timeout }: IONodeConnectionOptions): IONodeConnection {
		logger.debug('create() [url:%s]', url);
	
		const socket = io(url, {
			transports: [ 'websocket', 'polling' ],
			rejectUnauthorized: false,
			closeOnBeforeunload: false,
		});
	
		return new IONodeConnection(socket, timeout);
	}

	public closed = false;
	private socket: Socket<ClientServerEvents, ServerClientEvents>;

	constructor(socket: Socket<ClientServerEvents, ServerClientEvents>, timeout = 750) {
		super();

		logger.debug('constructor()');

		this.socket = socket;
		this.timeout = timeout;
		this.handleSocket();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close()');

		this.closed = true;
		logger.debug('close() [connected: %s]', this.socket.connected);
		if (this.socket.connected)
			this.socket.disconnect();

		this.socket.removeAllListeners();

		this.emit('close');
		this.socket.off();
	}

	public get id(): string {
		return this.socket.id;
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('notification() [notification: %o]', notification);

		this.socket.emit('notification', notification);
	}

	@skipIfClosed
	private sendRequestOnWire(socketMessage: SocketMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject('No socket connection');
			} else {
				this.socket.timeout(this.timeout).emit('request', socketMessage, (timeout, serverError, response) => {
					if (timeout) reject(new SocketTimeoutError('Request timed out'));
					else if (serverError) reject(serverError);
					else resolve(response);
				});
			}
		});
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('sendRequest() [request: %o]', request);
		try {
			return await this.sendRequestOnWire(request);
		} catch (error) {
			if (error instanceof SocketTimeoutError)
				logger.error(error);
			else
				throw error;
		}
	}

	private handleSocket(): void {
		logger.debug('handleSocket()');

		this.socket.on('connect', () => {
			logger.debug('handleSocket() connected');

			this.emit('connect');
		});

		this.socket.once('disconnect', () => {
			logger.debug('socket disconnected');

			this.close();
		});

		this.socket.on('notification', (notification) => {
			logger.debug('"notification" event [notification: %o]', notification);

			this.emit('notification', notification);
		});

		this.socket.on('request', (request, result) => {
			logger.debug('"request" event [request: %o]', request);

			this.emit(
				'request',
				request,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(response: any) => result(null, response),
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(error: any) => result(error, null)
			);
		});
	}
}