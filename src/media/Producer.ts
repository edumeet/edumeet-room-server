import EventEmitter from 'events';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Router } from './Router';
import { createProducerMiddleware } from '../middlewares/producerMiddleware';
import { MediaKind, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { ProducerScore } from '../common/types';
import { Logger, Middleware, skipIfClosed } from 'edumeet-common';

const logger = new Logger('Producer');

export interface ProducerOptions {
	id: string;
}

interface InternalProducerOptions extends ProducerOptions {
	router: Router;
	connection: MediaNodeConnection;
	kind: MediaKind;
	paused?: boolean;
	rtpParameters: RtpParameters;
	appData?: Record<string, unknown>;
}

export declare interface Producer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'score', listener: (score: ProducerScore[]) => void): this;
}

export class Producer extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public kind: MediaKind;
	public paused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	public score?: ProducerScore[];

	private producerMiddleware: Middleware<MediaNodeConnectionContext>;

	constructor({
		router,
		connection,
		id,
		kind,
		paused = false,
		rtpParameters,
		appData = {},
	}: InternalProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.kind = kind;
		this.paused = paused;
		this.rtpParameters = rtpParameters;
		this.appData = appData;

		this.producerMiddleware = createProducerMiddleware({ producer: this });

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		this.connection.pipeline.remove(this.producerMiddleware);

		if (!remoteClose) {
			this.connection.notify({
				method: 'closeProducer',
				data: {
					routerId: this.router.id,
					producerId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.on('close', () => this.close());

		this.connection.pipeline.use(this.producerMiddleware);
	}

	@skipIfClosed
	public setScore(score: ProducerScore[]): void {
		logger.debug('setScore()');

		this.score = score;

		this.emit('score', score);
	}

	@skipIfClosed
	public async pause(): Promise<void> {
		logger.debug('pause()');

		await this.connection.request({
			method: 'pauseProducer',
			data: {
				routerId: this.router.id,
				producerId: this.id,
			}
		});

		this.paused = true;
	}

	@skipIfClosed
	public async resume(): Promise<void> {
		logger.debug('resume()');

		await this.connection.request({
			method: 'resumeProducer',
			data: {
				routerId: this.router.id,
				producerId: this.id,
			}
		});

		this.paused = false;
	}
}