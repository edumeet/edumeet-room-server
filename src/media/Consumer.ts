import { EventEmitter } from 'events';
import { Router } from './Router';
import { ConsumerLayers, ConsumerScore } from '../common/types';
import { Logger, skipIfClosed, MediaKind } from 'edumeet-common';
import { MediaNode } from './MediaNode';
import { RtpParameters } from 'mediasoup/node/lib/RtpParameters';

const logger = new Logger('Consumer');

export interface ConsumerOptions {
	id: string;
	kind: MediaKind;
	paused: boolean;
	producerPaused: boolean;
	rtpParameters: RtpParameters;
}

interface InternalConsumerOptions extends ConsumerOptions {
	router: Router;
	mediaNode: MediaNode;
	producerId: string;
	appData?: Record<string, unknown>;
}

export declare interface Consumer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'producerpause', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'producerresume', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'score', listener: (score: ConsumerScore) => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'layerschange', listener: (layers: ConsumerLayers) => void): this;
}

export class Consumer extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public producerId: string;
	public kind: MediaKind;
	public paused: boolean;
	public preferredLayers: ConsumerLayers = { spatialLayer: 2, temporalLayer: 2 };
	public producerPaused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		producerId,
		kind,
		paused,
		producerPaused,
		rtpParameters,
		appData = {},
	}: InternalConsumerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.producerId = producerId;
		this.kind = kind;
		this.paused = paused;
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
				method: 'closeConsumer',
				data: {
					routerId: this.router.id,
					consumerId: this.id,
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

	@skipIfClosed
	public setScore(score: ConsumerScore): void {
		logger.debug('setScore()');

		this.emit('score', score);
	}

	@skipIfClosed
	public setLayers(layers?: ConsumerLayers): void {
		logger.debug('setLayers()');

		this.emit('layerschange', layers);
	}

	@skipIfClosed
	public async pause(): Promise<void> {
		logger.debug('pause()');

		await this.mediaNode.request({
			method: 'pauseConsumer',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
			}
		});

		this.paused = true;
	}

	@skipIfClosed
	public async resume(): Promise<void> {
		logger.debug('resume()');

		await this.mediaNode.request({
			method: 'resumeConsumer',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
			}
		});

		this.paused = false;
	}

	@skipIfClosed
	public async setPreferredLayers({
		spatialLayer,
		temporalLayer,
	}: {
		spatialLayer: number;
		temporalLayer?: number;
	}): Promise<void> {
		logger.debug('setPreferredLayers()');

		await this.mediaNode.request({
			method: 'setConsumerPreferredLayers',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
				spatialLayer,
				temporalLayer,
			}
		});

		this.preferredLayers = {
			spatialLayer,
			temporalLayer,
		};
	}

	@skipIfClosed
	public async setPriority(priority: number): Promise<void> {
		logger.debug('setPriority()');

		await this.mediaNode.request({
			method: 'setConsumerPriority',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
				priority,
			}
		});
	}

	@skipIfClosed
	public async requestKeyFrame(): Promise<void> {
		logger.debug('requestKeyFrame()');

		await this.mediaNode.request({
			method: 'requestConsumerKeyFrame',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
			}
		});
	}
}
