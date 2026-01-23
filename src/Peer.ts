import { EventEmitter } from 'events';
import { MediaSourceType, Role } from './common/types';
import { Router } from './media/Router';
import { WebRtcTransport } from './media/WebRtcTransport';
import { PlainTransport } from './media/PlainTransport';
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
import { RtpCapabilities, SctpCapabilities } from 'mediasoup/types';

const logger = new Logger('Peer');

interface PeerOptions {
	id: string;
	displayName?: string;
	picture?: string;
	sessionId: string;
	connection?: BaseConnection;
	managedId?: string;
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
}

export interface PeerContext {
	peer: Peer;
	message: SocketMessage;
	response: Record<string, unknown>;
	handled: boolean;
}

/* eslint-disable no-unused-vars */
export declare interface Peer {
	on(event: 'close', listener: () => void): this;
	on(event: 'notification', listener: InboundNotification): this;
	on(event: 'request', listener: InboundRequest): this;

	on(event: 'gotRole', listener: (newRole: Role) => void): this;
	on(event: 'lostRole', listener: (oldRole: Role) => void): this;
	on(event: 'sessionIdChanged', listener: (sessionId: string) => void): this;

	on(event: 'lostRouter', listener: () => void): this;
}
/* eslint-enable no-unused-vars */

type Transport = WebRtcTransport | PlainTransport;

export class Peer extends EventEmitter {
	public closed = false;

	public id: string;
	public managedId?: string;
	public groupIds: string[] = [];
	#permissions: string[] = [];

	public connections = List<BaseConnection>();

	public displayName: string;
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
	public sctpCapabilities?: SctpCapabilities;

	private turnCredentialsInterval?: NodeJS.Timeout;

	public consumingTransport?: Transport;
	public producingTransport?: Transport;
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
	}: PeerOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();

		this.id = id;
		this.#sessionId = sessionId;
		this.displayName = displayName ?? 'Guest';
		this.picture = picture;
		this.managedId = managedId;

		this.routerReset(true);

		if (connection)
			this.addConnection(connection);
	}

	public routerReset(initial = false): void {
		this.rtpCapabilities = undefined;
		this.sctpCapabilities = undefined;

		this.initialConsume = false;

		if (!initial) {
			this.notify({ method: 'lostMediaServer' });
			this.rejectRouterReady?.(new Error('Router reset'));
		}

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

			if (error) return logger.error('startTurnCredentialsRefresh() | failed to get router [error: %o]', error);

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

		this.connections.items.forEach((c) => c.close());
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

	public get permissions(): string[] {
		return this.#permissions;
	}

	public set permissions(value: string[]) {
		// Find the diff between the old and new permissions
		const added = value.filter((x) => !this.#permissions.includes(x));
		const removed = this.#permissions.filter((x) => !value.includes(x));

		// Update the permissions
		this.#permissions = value;

		// Notify the client of the changes
		added.forEach((permission) => this.notify({ method: 'permissionAdded', data: { permission } }));
		removed.forEach((permission) => this.notify({ method: 'permissionRemoved', data: { permission } }));

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
		return this.#permissions.includes(permission);
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
				logger.error({ err: error }, 'notification() [error: %o]');
			}
		});

		connection.on('request', async (request, respond, reject) => {
			try {
				const context = {
					peer: this,
					message: request,
					response: {},
					handled: false,
				} as PeerContext;

				await this.pipeline.execute(context);

				if (context.handled)
					respond(context.response);
				else {
					logger.debug('request() unhandled request [method: %s]', request.method);

					reject('Server error');
				}
			} catch (error) {
				logger.error({ err: error }, 'request() [error: %o]');
				if (error instanceof SocketTimeoutError) this.notify({ method: 'mediaConnectionError', data: { error } });

				reject?.('Server error');
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
				logger.error({ err: error }, 'notify() [error: %o]');
			}
		}

		logger.warn('notify() no connection available [peerId: %s]', this.id);
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [peerId: %s, method: %s]', this.id, request.method);

		for (const connection of this.connections.items) {
			try {
				return await connection.request(request);
			} catch (error) {
				logger.error({ err: error }, 'request() [error: %o]');
			}
		}

		logger.warn('request() no connection available [peerId: %s]', this.id);
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
		};
	}
}
