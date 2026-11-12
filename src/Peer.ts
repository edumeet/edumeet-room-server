import { BotType } from './common/botProfile';
import { EventEmitter } from 'events';
import { MediaSourceType, Role } from './common/types';
import { Router } from './media/Router';
import { WebRtcTransport } from './media/WebRtcTransport';
import { Consumer } from './media/Consumer';
import { Producer } from './media/Producer';
import {
	BaseConnection,
	InboundNotification,
	InboundRequest,
	List,
	Logger,
	Pipeline,
	skipIfClosed,
	SocketMessage,
	SocketTimeoutError
} from 'edumeet-common';
import { DataProducer } from './media/DataProducer';
import { DataConsumer } from './media/DataConsumer';
import { IOServerConnection, clientAddress } from './common/IOServerConnection';
import { Permission } from './common/authorization';
import { safePromise } from './common/safePromise';
import { IceServer, getCredentials, getIceServers } from './common/turnCredentials';
import { RtpCapabilities } from 'mediasoup/types';
import { displayNameText } from './common/textValidation';
import {
	ByteBudget,
	MAX_CHAT_MESSAGES_PER_MINUTE,
	MAX_MLS_JOINS_PER_MINUTE,
	MAX_MLS_KEY_PACKAGE_REQUESTS_PER_MINUTE,
	MAX_MLS_PROPOSALS_PER_MINUTE,
	MAX_RECONNECTS_PER_MINUTE,
	MAX_SESSION_CHANGES_PER_MINUTE,
	RateLimiter,
	Throttle,
	WHITEBOARD_BURST_BYTES,
	WHITEBOARD_BYTES_PER_SECOND,
	WHITEBOARD_MOVE_BYTES_PER_SECOND,
	WHITEBOARD_MOVE_INTERVAL_MS,
} from './common/rateLimiter';

const logger = new Logger('Peer');

interface PeerOptions {
	id: string;
	displayName?: string;
	picture?: string;
	sessionId: string;
	connection?: BaseConnection;
	managedId?: string;
	reconnectKey: string;
	permissions?: string[];
	meetingToken?: string;
	headless?: boolean;
	botVerified?: boolean;
	botType?: BotType;
	botSessionId?: string;
	botId?: string;
}

export interface PeerInfo {
	id: string;
	displayName?: string;
	picture?: string;
	raisedHand: boolean;
	raisedHandTimestamp?: number;
	sendReaction: string | null;
	sendReactionTimestamp?: number;
	sessionId: string;
	recording: boolean;
	headless: boolean;
	botType?: BotType;
	// Holds MODERATE_ROOM, so everyone can see who controls the room
	moderator: boolean;
}

export interface PeerContext {
	peer: Peer;
	message: SocketMessage;
	response: Record<string, unknown>;
	handled: boolean;
}

/* eslint-disable no-unused-vars */

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface Peer {
	on(event: 'close', listener: () => void): this;
	on(event: 'notification', listener: InboundNotification): this;
	on(event: 'request', listener: InboundRequest): this;

	on(event: 'gotRole', listener: (newRole: Role) => void): this;
	on(event: 'lostRole', listener: (oldRole: Role) => void): this;
	on(event: 'sessionIdChanged', listener: (sessionId: string) => void): this;
	on(event: 'managedIdChanged', listener: (oldId?: string, newId?: string) => void): this;
	on(event: 'moderatorChanged', listener: (moderator: boolean) => void): this;

	on(event: 'lostRouter', listener: () => void): this;
}

/* eslint-enable no-unused-vars */

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Peer extends EventEmitter {
	public closed = false;

	public id: string;
	#managedId?: string;
	#reconnectKey: string;
	public groupIds: string[] = [];
	#permissions: Set<string> = new Set();

	public connections = List<BaseConnection>();
	// Each reconnect and each change of session makes the server encode and send room state.
	public readonly reconnects = new RateLimiter(MAX_RECONNECTS_PER_MINUTE, 60_000);
	public readonly sessionChanges = new RateLimiter(MAX_SESSION_CHANGES_PER_MINUTE, 60_000);
	// Counted apart, so that a peer cannot use up what a moderator needs to move it, nor
	// a moderator what the peer needs to move itself.
	public readonly sessionMoves = new RateLimiter(MAX_SESSION_CHANGES_PER_MINUTE, 60_000);
	// mlsJoin answers with the group's GroupInfo, up to a megabyte.
	public readonly mlsJoins = new RateLimiter(MAX_MLS_JOINS_PER_MINUTE, 60_000);
	public readonly mlsKeyPackageRequests = new RateLimiter(MAX_MLS_KEY_PACKAGE_REQUESTS_PER_MINUTE, 60_000);
	public readonly mlsProposals = new RateLimiter(MAX_MLS_PROPOSALS_PER_MINUTE, 60_000);
	// What this peer sends that is passed on to everyone and kept for connection state recovery.
	public readonly chatMessages = new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000);
	public readonly whiteboardBytes = new ByteBudget(WHITEBOARD_BURST_BYTES, WHITEBOARD_BYTES_PER_SECOND);
	public readonly whiteboardMoves = new Throttle(WHITEBOARD_MOVE_INTERVAL_MS, WHITEBOARD_MOVE_BYTES_PER_SECOND);

	public displayName: string;
	public readonly meetingToken?: string;
	public readonly headless: boolean;
	public readonly botVerified: boolean;
	// Let into the room, past its lock and meeting token; a bot that was gets back in after a
	// long disconnect.
	public admitted = false;
	public readonly botType?: BotType;
	// The breakout session a bot was sent to; a participant picks sessions itself.
	public readonly botSessionId?: string;
	// The bot a provider started for this room's jobs; only a verified bot carries one.
	public readonly botId?: string;
	public picture?: string;

	public recording = false;

	#raisedHand = false;
	public raisedHandTimestamp?: number;
	#sendReaction: string | null = null;
	public sendReactionTimestamp?: number;
	#escapeMeeting = false;
	public escapeMeetingTimestamp?: number;

	public initialConsume = false;

	public rtpCapabilities?: RtpCapabilities;

	private turnCredentialsInterval?: NodeJS.Timeout;

	public router?: Router;
	public consumingTransport?: WebRtcTransport;
	public producingTransport?: WebRtcTransport;
	public consumers = new Map<string, Consumer>();
	public producers = new Map<string, Producer>();
	public dataConsumers = new Map<string, DataConsumer>();
	public dataProducers = new Map<string, DataProducer>();

	#sessionId: string;

	public pipeline = Pipeline<PeerContext>();

	// eslint-disable-next-line no-unused-vars
	public resolveRouterReady!: (router: Router) => void;
	// eslint-disable-next-line no-unused-vars
	public rejectRouterReady!: (error: Error) => void;
	public routerReady!: ReturnType<typeof safePromise<Router>>;

	constructor({
		id,
		managedId,
		displayName,
		picture,
		sessionId,
		connection,
		reconnectKey,
		permissions,
		meetingToken,
		headless = false,
		botVerified = false,
		botType,
		botSessionId,
		botId,
	}: PeerOptions) {
		logger.debug(
			{ id, managedId, displayName, sessionId, reconnectKey },
			'Peer constructor()'
		);

		super();

		this.id = id;
		this.#sessionId = sessionId;
		this.displayName = displayNameText(displayName) ?? 'Guest';
		this.picture = picture;
		this.#managedId = managedId;
		this.#reconnectKey = reconnectKey;
		this.meetingToken = meetingToken;
		this.headless = headless;
		this.botVerified = headless && botVerified;
		this.botType = headless ? botType : undefined;
		this.botSessionId = headless ? botSessionId : undefined;
		this.botId = this.botVerified ? botId : undefined;

		if (permissions?.length)
			this.#permissions = new Set(permissions);

		this.routerReset(true);

		if (connection)
			this.addConnection(connection);
	}

	public routerReset(initial = false): void {
		// close() already settled routerReady; a reset now would start a TURN refresh interval nothing clears.
		if (this.closed) return;

		this.router = undefined;
		this.rtpCapabilities = undefined;

		this.initialConsume = false;

		if (!initial) this.notify({ method: 'lostMediaServer' });

		// Settle the previous promise even on a reconnect reset, or anyone still awaiting it waits forever.
		this.rejectRouterReady?.(new Error('Router reset'));

		if (this.turnCredentialsInterval) {
			clearInterval(this.turnCredentialsInterval);
			this.turnCredentialsInterval = undefined;
		}

		this.routerReady = safePromise<Router>(new Promise<Router>((resolve, reject) => {
			this.resolveRouterReady = resolve;
			this.rejectRouterReady = reject;
		}));

		this.startTurnCredentialsRefresh();
	}

	private startTurnCredentialsRefresh(): void {
		this.turnCredentialsInterval = setInterval(async () => {
			let iceServers = [] as IceServer[];

			const [ error, router ] = await this.routerReady;

			if (error) return logger.error({ err: error }, 'startTurnCredentialsRefresh() | failed to get router');

			const { mediaNode: { turnHostname, turnports, secret } } = router;

			if (turnHostname)
				iceServers = getIceServers({ hostname: turnHostname, turnports: turnports, ...getCredentials(this.id, secret, 3600) });

			this.notify({ method: 'turnCredentials', data: { iceServers } });
		}, 3_000_000);
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close() [peerId: %s]', this.id);

		this.closed = true;

		if (this.turnCredentialsInterval) {
			clearInterval(this.turnCredentialsInterval);
			this.turnCredentialsInterval = undefined;
		}

		this.rejectRouterReady(new Error('Peer closed'));

		[ ...this.connections.items ].forEach((c) => c.close());
		this.producers.forEach((p) => p.close());
		this.consumers.forEach((c) => c.close());
		this.consumingTransport?.close();
		this.producingTransport?.close();

		this.connections.clear();
		this.producers.clear();
		this.consumers.clear();
		this.consumingTransport = undefined;
		this.producingTransport = undefined;

		this.emit('close');
	}

	// Counts connection switches. Something created for a request of an earlier connection
	// is not this connection's, and its answer went to a socket that is gone.
	public connectionGeneration = 0;

	@skipIfClosed
	public switchConnection(newConnection: BaseConnection): void {
		logger.debug('switchConnection() [peerId: %s]', this.id);

		// Requests still running for the old connection answer it, not the new one; what
		// they create for this peer is closed when it arrives (see connectionGeneration).
		this.connectionGeneration++;

		// Capture old connections before adding the new one.
		const oldConnections = [ ...this.connections.items ];

		// Add the new connection first so that when old connections emit 'close',
		// this.connections is not empty and peer.close() is not triggered.
		this.addConnection(newConnection);

		// Cancel reconnect timers and close old connections.
		// Each c.close() will fire the 'close' listener from addConnection which
		// removes the connection from this.connections — no manual clear() needed.
		oldConnections.forEach((c) => {
			if (c instanceof IOServerConnection) c.cancelClose();
			c.close();
		});

		this.consumers.forEach((c) => c.close());
		this.producers.forEach((p) => p.close());
		this.consumingTransport?.close();
		this.producingTransport?.close();

		this.consumers.clear();
		this.producers.clear();
		this.consumingTransport = undefined;
		this.producingTransport = undefined;

		// Reset media state; client handles reconnect so no lostMediaServer notification needed.
		this.routerReset(true);
	}

	// Give up the router and everything on it, as for a peer sent back to the lobby; a later
	// admission assigns a router again.
	public releaseMedia(): void {
		this.consumers.forEach((c) => c.close());
		this.producers.forEach((p) => p.close());
		this.dataProducers.forEach((p) => p.close());
		this.consumingTransport?.close();
		this.producingTransport?.close();

		this.consumers.clear();
		this.producers.clear();
		this.dataProducers.clear();
		this.consumingTransport = undefined;
		this.producingTransport = undefined;

		this.routerReset(true);
	}

	public closeProducers(): void {
		logger.debug('closeProducers() [peerId: %s]', this.id);

		this.producers.forEach((p) => p.close());
		this.producers.clear();
	}

	public set sessionId(sessionId: string) {
		const oldSessionId = this.#sessionId;

		this.#sessionId = sessionId;

		if (oldSessionId !== sessionId)
			this.emit('sessionIdChanged', sessionId);
	}

	public get sessionId(): string {
		return this.#sessionId;
	}

	public get managedId(): string | undefined {
		return this.#managedId;
	}

	public setManagedId(managedId?: string): void {
		const oldManagedId = this.#managedId;

		if (oldManagedId === managedId)
			return;

		this.#managedId = managedId;

		this.emit('managedIdChanged', oldManagedId, managedId);
	}

	public get reconnectKey(): string {
		return this.#reconnectKey;
	}

	public get permissions(): string[] {
		return [ ...this.#permissions ];
	}

	public set permissions(value: string[]) {
		const newPermissions = new Set(value);

		// Find the diff between the old and new permissions
		const added = [ ...newPermissions ].filter((x) => !this.#permissions.has(x));
		const removed = [ ...this.#permissions ].filter((x) => !newPermissions.has(x));

		// Update the permissions
		this.#permissions = newPermissions;

		// Notify the client of the changes
		added.forEach((permission) => this.notify({ method: 'permissionAdded', data: { permission } }));
		removed.forEach((permission) => this.notify({ method: 'permissionRemoved', data: { permission } }));

		if (added.includes(Permission.MODERATE_ROOM)) this.emit('moderatorChanged', true);
		if (removed.includes(Permission.MODERATE_ROOM)) this.emit('moderatorChanged', false);

		if (removed.includes(Permission.SHARE_AUDIO)) {
			this.producers.forEach((p) => {
				if (p.appData.source === MediaSourceType.MIC || p.appData.source === MediaSourceType.SCREENAUDIO)
					p.close();
			});
		}

		if (removed.includes(Permission.SHARE_VIDEO)) {
			this.producers.forEach((p) => {
				if (p.appData.source === MediaSourceType.WEBCAM)
					p.close();
			});
		}

		if (removed.includes(Permission.SHARE_SCREEN)) {
			this.producers.forEach((p) => {
				if (p.appData.source === MediaSourceType.SCREEN)
					p.close();
			});
		}

		if (removed.includes(Permission.SHARE_EXTRA_VIDEO)) {
			this.producers.forEach((p) => {
				if (p.appData.source === MediaSourceType.EXTRAVIDEO)
					p.close();
			});
		}
	}

	public hasPermission(permission: Permission): boolean {
		return this.#permissions.has(permission);
	}

	public get raisedHand(): boolean {
		return this.#raisedHand;
	}

	public set raisedHand(value: boolean) {
		this.#raisedHand = value;
		this.raisedHandTimestamp = Date.now();
	}

	public get sendReaction(): string | null {
		return this.#sendReaction;
	}

	public set sendReaction(value: string | null) {
		this.#sendReaction = value;
		this.sendReactionTimestamp = Date.now();
	}

	public get escapeMeeting(): boolean {
		return this.#escapeMeeting;
	}

	public set escapeMeeting(value: boolean) {
		this.#escapeMeeting = value;
		this.escapeMeetingTimestamp = Date.now();
	}

	// Every connection has dropped and is only waiting out its reconnect window.
	public get connectionLost(): boolean {
		return this.connections.length > 0 && this.connections.items.every((c) => (c as { disconnected?: boolean }).disconnected === true);
	}

	@skipIfClosed
	public addConnection(connection: BaseConnection): void {
		logger.debug('addConnection()');

		this.connections.add(connection);

		connection.on('notification', async (notification) => {
			try {
				const context = {
					peer: this,
					message: notification,
					response: {},
					handled: false,
				} as PeerContext;

				await this.pipeline.execute(context);

				if (!context.handled)
					throw new Error('no middleware handled the notification');
			} catch (error) {
				logger.error({ err: error }, 'notification() failed');
			}
		});

		connection.on('request', async (request, respond, reject) => {
			// Answering must never throw out of this listener: an unhandled rejection ends
			// the process (see server.ts), and with it every meeting on this server.
			const answer = (send: unknown, value: unknown) => {
				try {
					if (typeof send === 'function') send(value);
				} catch (error) {
					logger.warn({ err: error }, 'request() could not answer');
				}
			};

			try {
				const context = {
					peer: this,
					message: request,
					response: {},
					handled: false,
				} as PeerContext;

				await this.pipeline.execute(context);

				if (context.handled)
					answer(respond, context.response);
				else {
					logger.debug('request() unhandled request [method: %s]', request?.method);

					answer(reject, 'Server error');
				}
			} catch (error) {
				logger.error({ err: error }, 'request() failed');
				if (error instanceof SocketTimeoutError) this.notify({ method: 'mediaConnectionError', data: { error } });

				answer(reject, 'Server error');
			}
		});

		connection.once('close', () => {
			this.connections.remove(connection);

			if (this.connections.length === 0)
				this.close();
		});
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('notify() [peerId: %s, method: %s]', this.id, notification.method);

		for (const connection of this.connections.items) {
			try {
				return connection.notify(notification);
			} catch (error) {
				logger.error({ err: error }, 'notify() failed');
			}
		}

		logger.warn('notify() no connection available [peerId: %s]', this.id);
	}

	// For the state of a room at one moment, see IOServerConnection.notifyOnce().
	public notifyOnce(notification: SocketMessage): void {
		logger.debug('notifyOnce() [peerId: %s, method: %s]', this.id, notification.method);

		for (const connection of this.connections.items) {
			try {
				// Another kind of connection may keep what it is given, so it gets a copy.
				return connection instanceof IOServerConnection ? connection.notifyOnce(notification) : connection.notify(structuredClone(notification));
			} catch (error) {
				logger.error({ err: error }, 'notifyOnce() failed');
			}
		}

		logger.warn('notifyOnce() no connection available [peerId: %s]', this.id);
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [peerId: %s, method: %s]', this.id, request.method);

		for (const connection of this.connections.items) {
			try {
				return await connection.request(request);
			} catch (error) {
				logger.error({ err: error }, 'request() failed');
			}
		}

		throw new Error(`request() no connection available [peerId: ${this.id}]`);
	}

	public getAddress(): clientAddress {
		const connection = this.connections.items[0] as unknown as IOServerConnection;

		return connection.address;
	}

	public sameSession(peer: Peer): boolean {
		return this.sessionId === peer.sessionId;
	}

	public get peerInfo(): PeerInfo {
		return {
			id: this.id,
			displayName: this.displayName,
			picture: this.picture,
			raisedHand: this.raisedHand,
			raisedHandTimestamp: this.raisedHandTimestamp,
			sendReaction: this.sendReaction,
			sendReactionTimestamp: this.sendReactionTimestamp,
			sessionId: this.sessionId,
			recording: this.recording,
			headless: this.headless,
			botType: this.botType,
			moderator: this.hasPermission(Permission.MODERATE_ROOM),
		};
	}
}
