import {
	BaseConnection,
	Logger,
	SocketMessage,
	SocketTimeoutError,
	skipIfClosed,
} from 'edumeet-common';
import { Socket } from 'socket.io';

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

export type clientAddress = {
	address: string
	forwardedFor?: string | string[]
}

const logger = new Logger('SocketIOConnection');

// Deeper than anything the client sends. socket.io decodes nesting of any depth, but
// encoding it again overflows the stack, and with connection state recovery a stored
// packet is encoded again where nothing catches the error, which ends the process.
const MAX_DEPTH = 32;

// Without recursion, so the check itself cannot overflow the stack.
export const tooDeep = (value: unknown, max = MAX_DEPTH): boolean => {
	const stack: Array<[ unknown, number ]> = [ [ value, 0 ] ];

	while (stack.length > 0) {
		const [ current, depth ] = stack.pop() as [ unknown, number ];

		if (current === null || typeof current !== 'object') continue;
		if (depth >= max) return true;

		for (const child of Object.values(current as Record<string, unknown>)) stack.push([ child, depth + 1 ]);
	}

	return false;
};

export class IOServerConnection extends BaseConnection {
	public closed = false;
	private socket: Socket<ClientServerEvents, ServerClientEvents>;
	private reconnectTimer?: ReturnType<typeof setTimeout>;

	constructor(socket: Socket<ClientServerEvents, ServerClientEvents>) {
		super();

		logger.debug('constructor()');

		this.socket = socket;
		this.handleSocket();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close() [id: %s]', this.id);

		this.closed = true;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}

		if (this.socket.connected)
			this.socket.disconnect(true);

		this.forgetRecoverableSession();

		this.socket.removeAllListeners();

		this.emit('close');
	}

	// A socket that dropped leaves socket.io a session it restores for five minutes, with every
	// notification sent since. Once the connection is closed, the peer is gone from its room,
	// and a restore would hand it what the room said and shared after that.
	private forgetRecoverableSession(): void {
		const { pid, nsp } = this.socket as unknown as { pid?: string; nsp?: { adapter?: { sessions?: Map<string, unknown> } } };

		if (pid) nsp?.adapter?.sessions?.delete(pid);
	}

	// The socket dropped and the window for it to come back is still open.
	public get disconnected(): boolean {
		return Boolean(this.reconnectTimer);
	}

	public cancelClose(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
			logger.debug('cancelClose() reconnect window cancelled [id: %s]', this.id);
		}
	}

	public get id(): string {
		return this.socket.id;
	}

	public get address(): clientAddress {
		const address: clientAddress = {
			address: this.socket.handshake.address,
			forwardedFor: this.socket.handshake.headers['x-forwarded-for']
		};
	
		return address;
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
				this.socket.timeout(3000).emit('request', socketMessage, (timeout, serverError, response) => {
					if (timeout) reject(new SocketTimeoutError('Request timed out'));
					else if (serverError) reject(serverError);
					// An answer is stored and sent on as well (rtpCapabilities), so it gets the same
					// depth limit as what the client sends on its own.
					else if (tooDeep(response)) reject(new Error('answer nested too deeply'));
					else resolve(response);
				});
			}
		});
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('sendRequest() [request: %o]', request);

		for (let tries = 0; tries < 3; tries++) {
			try {
				return await this.sendRequestOnWire(request);
			} catch (error) {
				if (error instanceof SocketTimeoutError)
					logger.warn('sendRequest() timeout, retrying [attempt: %s]', tries);
				else
					throw error;
			}
		}

		// if all attempts failed throw
		throw new SocketTimeoutError('sendRequest() - All attempts of sendRequest timed out');
	}

	private handleSocket(): void {
		logger.debug('handleSocket()');

		this.socket.once('disconnect', (reason: string) => {
			logger.debug('socket disconnected [id: %s, reason: %s]', this.id, reason);

			if (reason === 'client namespace disconnect') {
				// Client intentionally disconnected (leave button, kick, etc.) — close immediately.
				this.close();
			} else {
				// Unintentional disconnect (network drop) — allow reconnect window.
				logger.debug('starting reconnect window [id: %s]', this.id);

				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = undefined;
					this.close();
				}, 5_000);
			}
		});

		this.socket.on('notification', (notification) => {
			logger.debug('"notification" event [notification: %o]', notification);

			if (tooDeep(notification)) return logger.warn('"notification" nested too deeply, ignored');

			this.emit('notification', notification);
		});

		this.socket.on('request', (request, result) => {
			logger.debug('"request" event [request: %o]', request);

			// A request is answered through its acknowledgement. Without one there is no one to
			// answer, and calling it would throw out of the listener and end the process.
			if (typeof result !== 'function') return;

			if (!request || typeof request !== 'object' || typeof request.method !== 'string' || tooDeep(request))
				return result('Invalid request', null);

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
