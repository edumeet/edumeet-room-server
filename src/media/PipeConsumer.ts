import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed, MediaKind } from 'edumeet-common';
import { MediaNode } from './MediaNode';
import { RtpParameters } from 'mediasoup/node/lib/RtpParameters';

const logger = new Logger('PipeConsumer');

export interface PipeConsumerOptions {
	id: string;
	kind: MediaKind;
	producerPaused: boolean;
	rtpParameters: RtpParameters;
}

interface InternalPipeConsumerOptions extends PipeConsumerOptions {
	router: Router;
	mediaNode: MediaNode;
	producerId: string;
	appData?: Record<string, unknown>;
}

export declare interface PipeConsumer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'producerpause', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'producerresume', listener: () => void): this;
}

export class PipeConsumer extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public producerId: string;
	public kind: MediaKind;
	public producerPaused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
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
		this.mediaNode = mediaNode;
		this.id = id;
		this.producerId = producerId;
		this.kind = kind;
		this.producerPaused = producerPaused;
		this.rtpParameters = rtpParameters;
		this.appData = appData;
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
				method: 'closePipeConsumer',
				data: {
					routerId: this.router.id,
					pipeConsumerId: this.id,
				}
			});
		}

		this.emit('close', remoteClose);
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
