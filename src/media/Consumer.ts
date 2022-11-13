import EventEmitter from 'events';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Router } from './Router';
import { createConsumerMiddleware } from '../middlewares/consumerMiddleware';
import { MediaKind, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { ConsumerLayers, ConsumerScore } from '../common/types';
import { Logger, Middleware, skipIfClosed } from 'edumeet-common';

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
	connection: MediaNodeConnection;
	producerId: string;
	appData?: Record<string, unknown>;
}

export declare interface Consumer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
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
	public connection: MediaNodeConnection;
	public id: string;
	public producerId: string;
	public kind: MediaKind;
	public paused: boolean;
	public producerPaused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	private consumerMiddleware: Middleware<MediaNodeConnectionContext>;

	constructor({
		router,
		connection,
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
		this.connection = connection;
		this.id = id;
		this.producerId = producerId;
		this.kind = kind;
		this.paused = paused;
		this.producerPaused = producerPaused;
		this.rtpParameters = rtpParameters;
		this.appData = appData;

		this.consumerMiddleware = createConsumerMiddleware({ consumer: this });

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		this.connection.pipeline.remove(this.consumerMiddleware);

		if (!remoteClose) {
			this.connection.notify({
				method: 'closeConsumer',
				data: {
					routerId: this.router.id,
					consumerId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));

		this.connection.pipeline.use(this.consumerMiddleware);
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

		await this.connection.request({
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

		await this.connection.request({
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
		spatialLayer?: number;
		temporalLayer?: number;
	}): Promise<void> {
		logger.debug('setPreferredLayers()');

		await this.connection.request({
			method: 'setConsumerPreferredLayers',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
				spatialLayer,
				temporalLayer,
			}
		});
	}

	@skipIfClosed
	public async setPriority(priority: number): Promise<void> {
		logger.debug('setPriority()');

		await this.connection.request({
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

		await this.connection.request({
			method: 'requestConsumerKeyFrame',
			data: {
				routerId: this.router.id,
				consumerId: this.id,
			}
		});
	}
}