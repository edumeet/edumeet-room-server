import EventEmitter from 'events';
import { Logger } from '../common/logger';
import { BaseConnection, InboundRequest } from '../signaling/BaseConnection';
import { SocketMessage } from '../signaling/SignalingInterface';
import { Pipeline } from '../common/middleware';
import { skipIfClosed } from '../common/decorators';

const logger = new Logger('MediaNodeConnection');

interface MediaNodeConnectionOptions {
	connection: BaseConnection;
}

export interface MediaNodeConnectionContext {
	message: SocketMessage;
	response: Record<string, unknown>;
	handled: boolean;
}

/* eslint-disable no-unused-vars */
export declare interface MediaNodeConnection {
	on(event: 'close', listener: () => void): this;
	on(event: 'notification', listener: (notification: SocketMessage) => void): this;
	on(event: 'request', listener: InboundRequest): this;
}
/* eslint-enable no-unused-vars */

export class MediaNodeConnection extends EventEmitter {
	public closed = false;
	public connection: BaseConnection;
	public pipeline = Pipeline<MediaNodeConnectionContext>();

	private resolveReady!: () => void;
	public ready = new Promise<void>((resolve) => {
		this.resolveReady = resolve;
	});

	constructor({
		connection,
	}: MediaNodeConnectionOptions) {
		logger.debug('constructor()');

		super();

		this.connection = connection;
		this.handleConnection();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close()');

		this.closed = true;

		this.connection.close();

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection(): void {
		logger.debug('addConnection()');

		this.connection.on('notification', async (notification) => {
			if (notification.method === 'mediaNodeReady')
				return this.resolveReady();

			try {
				const context = {
					mediaNodeConnection: this,
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

		this.connection.on('request', async (request, respond, reject) => {
			try {
				const context = {
					mediaNodeConnection: this,
					message: request,
					response: {},
					handled: false,
				} as MediaNodeConnectionContext;

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

		this.connection.once('close', () => this.close());
	}

	@skipIfClosed
	public async notify(notification: SocketMessage): Promise<void> {
		logger.debug('notify() [method: %s]', notification.method);

		try {
			return await this.connection.notify(notification);
		} catch (error) {
			logger.error('notify() [error: %o]', error);
		}
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [method: %s]', request.method);

		try {
			return await this.connection.request(request);
		} catch (error) {
			logger.error('request() [error: %o]', error);
		}
	}
}