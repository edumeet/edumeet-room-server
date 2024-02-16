import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed, MediaKind } from 'edumeet-common';
import { MediaNode } from './MediaNode';
import { RtpParameters } from 'mediasoup/node/lib/RtpParameters';

const logger = new Logger('PipeProducer');

export interface PipeProducerOptions {
	id: string;
}

interface InternalPipeProducerOptions extends PipeProducerOptions {
	router: Router;
	mediaNode: MediaNode;
	kind: MediaKind;
	paused?: boolean;
	rtpParameters: RtpParameters;
	appData?: Record<string, unknown>;
}

export declare interface PipeProducer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class PipeProducer extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public kind: MediaKind;
	public paused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		kind,
		paused = false,
		rtpParameters,
		appData = {},
	}: InternalPipeProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.kind = kind;
		this.paused = paused;
		this.rtpParameters = rtpParameters;
		this.appData = appData;
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
				method: 'closePipeProducer',
				data: {
					routerId: this.router.id,
					pipeProducerId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	public async pause(): Promise<void> {
		logger.debug('pause()');

		await this.mediaNode.request({
			method: 'pausePipeProducer',
			data: {
				routerId: this.router.id,
				pipeProducerId: this.id,
			}
		});
	}

	@skipIfClosed
	public async resume(): Promise<void> {
		logger.debug('resume()');

		await this.mediaNode.request({
			method: 'resumePipeProducer',
			data: {
				routerId: this.router.id,
				pipeProducerId: this.id,
			}
		});
	}
}
