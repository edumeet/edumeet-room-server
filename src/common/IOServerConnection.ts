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

// socket.io-parser's PacketType.EVENT
const EVENT_PACKET = 2;

// What engine.io, the WebSocket and its TCP socket hold of a connection. Not part of socket.io's
// documented interface; missing parts count as nothing waiting.
type WebSocketInternals = {
	bufferedAmount?: number;
	terminate?: () => void;
	_socket?: { _handle?: { writeQueueSize?: number } };
};
type EngineInternals = {
	readyState?: string;
	writeBuffer?: Array<{ data?: unknown }>;
	transport?: { socket?: WebSocketInternals };
	// eslint-disable-next-line no-unused-vars
	close?: (discard?: boolean) => void;
};

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
	// A client that does not read keeps in memory everything sent to it, as long as it answers
	// pings. About twice the largest state of a room may wait; past that the connection is cut,
	// and a client that reads connects again.
	public static maxUnsentBytes = 32 * 1024 * 1024;
	// Counting stops here: a client this far behind is cut whatever the packets hold.
	public static maxUnsentPackets = 20_000;
	// How long data may wait without any of it going out before the connection is cut: after a
	// close, or while more than stallBytes wait. The system takes more from a full send buffer
	// only once much of it has been read, so a client that reads slowly can show no progress
	// for many seconds.
	public static stallMs = 30_000;
	public static stallBytes = 1024 * 1024;

	public closed = false;
	private socket: Socket<ClientServerEvents, ServerClientEvents>;
	private reconnectTimer?: ReturnType<typeof setTimeout>;
	private stallWatch?: ReturnType<typeof setInterval>;

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

		if (this.socket.connected) {
			// Ends the session without keeping it; what was sent last (a kick, a refusal) still goes
			// out first. engine.io closes once that has gone out, which a client that does not read
			// never lets happen.
			this.socket.disconnect(true);

			if (this.unsentBytes > 0) this.watchDelivery();
		}

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

	// Bytes handed to socket.io for this client that have not gone out yet.
	public get unsentBytes(): number {
		const engine = this.engine;
		const waiting = engine?.writeBuffer ?? [];

		if (waiting.length > IOServerConnection.maxUnsentPackets) return Number.POSITIVE_INFINITY;

		let bytes = engine?.transport?.socket?.bufferedAmount ?? 0;

		for (const { data } of waiting) {
			if (typeof data === 'string') bytes += data.length;
			else if (data instanceof Uint8Array) bytes += data.byteLength;
		}

		return bytes;
	}

	private get engine() {
		return this.socket.conn as unknown as EngineInternals | undefined;
	}

	private get webSocket() {
		return this.engine?.transport?.socket;
	}

	// What the system still has to take of the message going out. unsentBytes goes down only
	// once a whole message has gone out; this goes down while it does.
	private get queuedBytes(): number {
		return this.webSocket?._socket?._handle?.writeQueueSize ?? 0;
	}

	// Ends the connection at once, as a network failure does: a graceful close would wait, with
	// the buffers, for a client that does not read.
	private cut(): void {
		const webSocket = this.webSocket;

		if (typeof webSocket?.terminate === 'function') webSocket.terminate();
		else this.engine?.close?.(true);
	}

	private notReading(): void {
		logger.warn('the client does not read what it is sent, connection cut [id: %s]', this.id);

		if (!this.closed) this.emit('notReading');

		this.cut();
	}

	// After a close nothing more is sent, so what waits only gets less while the client reads;
	// before, the client is watched while more than stallBytes wait. Once nothing has gone out
	// for stallMs, the connection is cut.
	private watchDelivery(): void {
		if (this.stallWatch) return;

		let unsent = this.unsentBytes;
		let queued = this.queuedBytes;
		let progressAt = Date.now();

		this.stallWatch = setInterval(() => {
			const nowUnsent = this.unsentBytes;
			const nowQueued = this.queuedBytes;

			if (this.engine?.readyState === 'closed' || nowUnsent <= (this.closed ? 0 : IOServerConnection.stallBytes))
				return this.stopWatching();

			if (nowUnsent < unsent || nowQueued < queued) progressAt = Date.now();
			else if (Date.now() - progressAt >= IOServerConnection.stallMs) {
				this.stopWatching();

				return this.notReading();
			}

			unsent = nowUnsent;
			queued = nowQueued;
		}, Math.min(1_000, IOServerConnection.stallMs / 4));

		this.stallWatch.unref?.();
	}

	private stopWatching(): void {
		clearInterval(this.stallWatch);
		this.stallWatch = undefined;
	}

	private keepsUp(): boolean {
		if (this.unsentBytes <= IOServerConnection.maxUnsentBytes) return true;

		this.notReading();

		return false;
	}

	private sent(): void {
		if (!this.stallWatch && this.unsentBytes > IOServerConnection.stallBytes) this.watchDelivery();
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('notification() [notification: %o]', notification);

		if (!this.keepsUp()) return;

		this.socket.emit('notification', notification);
		this.sent();
	}

	/**
	 * A notification that is written to the socket and then forgotten. What notify() sends,
	 * socket.io keeps for connection state recovery until the recovery time has passed,
	 * whoever it was for. A copy of a room's state must not pile up there: a client can ask
	 * for one as often as it likes. The packet is encoded here and now, so it needs no copy
	 * of its own, and a client that misses it gets a newer one when it connects again.
	 */
	@skipIfClosed
	public notifyOnce(notification: SocketMessage): void {
		logger.debug('notifyOnce() [method: %s]', notification.method);

		if (!this.keepsUp()) return;

		// eslint-disable-next-line no-unused-vars
		const socket = this.socket as unknown as { packet?: (...args: unknown[]) => void };

		// Not part of socket.io's documented interface. Without it the state still has to
		// arrive, as a copy: what socket.io keeps, it encodes again at a replay, and that
		// must not show what was said or drawn later.
		if (typeof socket.packet !== 'function') {
			logger.error('notifyOnce() socket.packet() is missing, the notification is kept for recovery');

			return this.notify(structuredClone(notification));
		}

		socket.packet({ type: EVENT_PACKET, data: [ 'notification', notification ] });
		this.sent();
	}

	@skipIfClosed
	private sendRequestOnWire(socketMessage: SocketMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject('No socket connection');
			} else if (!this.keepsUp()) {
				reject(new Error('the client does not read what it is sent'));
			} else {
				this.socket.timeout(3000).emit('request', socketMessage, (timeout, serverError, response) => {
					if (timeout) reject(new SocketTimeoutError('Request timed out'));
					else if (serverError) reject(serverError);
					// An answer is stored and sent on as well (rtpCapabilities), so it gets the same
					// depth limit as what the client sends on its own.
					else if (tooDeep(response)) reject(new Error('answer nested too deeply'));
					else resolve(response);
				});
				this.sent();
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

			// An answer waits for a client that does not read like any notification does.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const answer = (error: any, response: any) => {
				if (!this.keepsUp()) return;

				result(error, response);
				this.sent();
			};

			this.emit(
				'request',
				request,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(response: any) => answer(null, response),
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(error: any) => answer(error, null)
			);
		});
	}
}
