import { EventEmitter } from 'events';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router } from './Router';
import { RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { Logger, skipIfClosed } from 'edumeet-common';
import { MediaKind } from 'edumeet-common';

const logger = new Logger('PipeConsumer');

export interface PipeConsumerOptions {
	id: string;
	kind: MediaKind;
	producerPaused: boolean;
	rtpParameters: RtpParameters;
}

interface InternalPipeConsumerOptions extends PipeConsumerOptions {
	router: Router;
	connection: MediaNodeConnection;
	producerId: string;
	appData?: Record<string, unknown>;
}

export declare interface PipeConsumer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'producerpause', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'producerresume', listener: () => void): this;
}

export class PipeConsumer extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public producerId: string;
	public kind: MediaKind;
	public producerPaused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	constructor({
		router,
		connection,
		id,
		producerId,
		kind,
		producerPaused,
		rtpParameters,
		appData = {},
	}: InternalPipeConsumerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.producerId = producerId;
		this.kind = kind;
		this.producerPaused = producerPaused;
		this.rtpParameters = rtpParameters;
		this.appData = appData;

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.connection.notify({
				method: 'closePipeConsumer',
				data: {
					routerId: this.router.id,
					pipeConsumerId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));
	}

	@skipIfClosed
	public setProducerPaused(): void {
		logger.debug('setProducerPaused()');

		this.producerPaused = true;

		this.emit('producerpause');
	}

	@skipIfClosed
	public setProducerResumed(): void {
		logger.debug('setProducerResumed()');

		this.producerPaused = false;

		this.emit('producerresume');
	}
}