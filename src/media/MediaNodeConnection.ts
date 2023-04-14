import { EventEmitter } from 'events';
import { BaseConnection, InboundNotification, InboundRequest, Logger, Pipeline, skipIfClosed, SocketMessage } from 'edumeet-common';

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
	on(event: 'notification', listener: InboundNotification): this;
	on(event: 'request', listener: InboundRequest): this;
}
/* eslint-enable no-unused-vars */

export class MediaNodeConnection extends EventEmitter {
	public closed = false;
	public connection: BaseConnection;
	public pipeline = Pipeline<MediaNodeConnectionContext>();
	private _load: number | undefined;

	private resolveReady!: () => void;
	public ready = new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		setTimeout(() => { reject('Timeout waiting for media-node connection'); }, 750);
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

		this.connection.on('notification', async (notification) => {
			this._load = notification.data?.load;

			if (notification.method === 'mediaNodeReady') {
				
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

		this.connection.on('request', async (request, respond, reject) => {
			try {
				this._load = request.data?.load;
				const context = {
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
	public notify(notification: SocketMessage): void {
		logger.debug('notify() [method: %s]', notification.method);

		this.connection.notify(notification);
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('request() [method: %s]', request.method);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const response: any = await this.connection.request(request);

		this._load = response?.load;
			
		return response;
	}

	public get load(): number | undefined {
		return this._load;
	}
}