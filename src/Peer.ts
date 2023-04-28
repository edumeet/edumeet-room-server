import { EventEmitter } from 'events';
import * as jwt from 'jsonwebtoken';
import { signingkey } from './common/token';
import { userRoles } from './common/authorization';
import { Role } from './common/types';
import { Router } from './media/Router';
import { WebRtcTransport } from './media/WebRtcTransport';
import { Consumer } from './media/Consumer';
import { Producer } from './media/Producer';
import { RtpCapabilities } from 'mediasoup-client/lib/RtpParameters';
import { SctpCapabilities } from 'mediasoup-client/lib/SctpParameters';
import {
	BaseConnection,
	InboundNotification,
	InboundRequest,
	IOServerConnection,
	List,
	Logger,
	Pipeline,
	skipIfClosed,
	SocketMessage
} from 'edumeet-common';
import { DataProducer } from './media/DataProducer';
import { DataConsumer } from './media/DataConsumer';
import { clientAddress } from 'edumeet-common/lib/IOServerConnection';

const logger = new Logger('Peer');

interface PeerOptions {
	id: string;
	displayName?: string;
	picture?: string;
	roomId: string;
	connection?: BaseConnection;
	token?: string;
}

export interface PeerInfo {
	id: string;
	displayName?: string;
	picture?: string;
	roles: number[];
	audioOnly: boolean;
	recordable?: boolean;
	raisedHand: boolean;
	raisedHandTimestamp?: number;
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
}
/* eslint-enable no-unused-vars */

export class Peer extends EventEmitter {
	public id: string;
	public closed = false;
	public roles: Role[] = [ userRoles.NORMAL ];
	public connections = List<BaseConnection>();
	public displayName: string;
	public picture?: string;
	#audioOnly = false;
	#recordable = false;
	#raisedHand = false;
	public raisedHandTimestamp?: number;
	#escapeMeeting = false;
	public escapeMeetingTimestamp?: number;
	public routerId?: string;
	public rtpCapabilities?: RtpCapabilities;
	public sctpCapabilities?: SctpCapabilities;
	#router?: Router;
	public transports = new Map<string, WebRtcTransport>();
	public consumers = new Map<string, Consumer>();
	public producers = new Map<string, Producer>();
	public dataConsumers = new Map<string, DataConsumer>();
	public dataProducers = new Map<string, DataProducer>();
	public roomId: string;
	public pipeline = Pipeline<PeerContext>();
	public readonly token: string;

	constructor({
		id,
		token,
		displayName,
		picture,
		roomId,
		connection,
	}: PeerOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();

		this.id = id;
		this.roomId = roomId;
		this.displayName = displayName ?? 'Guest';
		this.picture = picture;
		this.token = token ?? this.assignToken();

		if (connection)
			this.addConnection(connection);
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close() [peerId: %s]', this.id);

		this.closed = true;

		this.connections.items.forEach((c) => c.close());
		this.producers.forEach((p) => p.close());
		this.consumers.forEach((c) => c.close());
		this.transports.forEach((t) => t.close());

		this.connections.clear();
		this.producers.clear();
		this.consumers.clear();
		this.transports.clear();

		this.emit('close');
	}

	public get audioOnly(): boolean {
		return this.#audioOnly;
	}

	public set audioOnly(value: boolean) {
		this.#audioOnly = value;
	}

	public get recordable(): boolean {
		return this.#recordable;
	}

	public set recordable(value: boolean) {
		this.#recordable = value;
	}

	public get raisedHand(): boolean {
		return this.#raisedHand;
	}

	public set raisedHand(value: boolean) {
		this.#raisedHand = value;
		this.raisedHandTimestamp = Date.now();
	}

	public get escapeMeeting(): boolean {
		return this.#escapeMeeting;
	}

	public set escapeMeeting(value: boolean) {
		this.#escapeMeeting = value;
		this.escapeMeetingTimestamp = Date.now();
	}

	public get router(): Router | undefined {
		return this.#router;
	}

	public set router(router: Router | undefined) {
		if (!router) return;

		router.once('close', () => (this.#router = undefined));

		this.#router = router;
	}

	@skipIfClosed
	public addRole(newRole: Role): void {
		const index = this.roles.findIndex((r) => r.id === newRole.id);

		if (index === -1 && newRole.id !== userRoles.NORMAL.id) {
			this.roles.push(newRole);
			this.emit('gotRole', { newRole });
		}
	}

	@skipIfClosed
	public removeRole(oldRole: Role): void {
		const index = this.roles.findIndex((r) => r.id === oldRole.id);

		if (index !== -1 && oldRole.id !== userRoles.NORMAL.id) {
			this.roles.splice(index, 1);
			this.emit('lostRole', { oldRole });
		}
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
				logger.error('notification() [error: %o]', error);
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
				logger.error('request() [error: %o]', error);

				reject('Server error');
			}
		});

		connection.once('close', () => {
			this.connections.remove(connection);

			if (this.connections.length === 0)
				this.close();
		});

		connection.notify({
			method: 'token',
			data: { token: this.token }
		});
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('notify() [peerId: %s, method: %s]', this.id, notification.method);

		for (const connection of this.connections.items) {
			try {
				return connection.notify(notification);
			} catch (error) {
				logger.error('notify() [error: %o]', error);
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
				logger.error('request() [error: %o]', error);
			}
		}

		logger.warn('request() no connection available [peerId: %s]', this.id);
	}

	private assignToken(): string {
		return jwt.sign({ id: this.id }, signingkey, { noTimestamp: true });
	}

	public getAddress(): clientAddress {
		const connection = this.connections.items[0] as unknown as IOServerConnection;
		
		return connection.address;
	}

	public get peerInfo(): PeerInfo {
		return {
			id: this.id,
			displayName: this.displayName,
			picture: this.picture,
			audioOnly: this.audioOnly,
			recordable: this.recordable,
			raisedHand: this.raisedHand,
			raisedHandTimestamp: this.raisedHandTimestamp,
			roles: this.roles.map((role) => role.id),
		};
	}
}