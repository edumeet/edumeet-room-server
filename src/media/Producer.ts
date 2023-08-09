import { EventEmitter } from 'events';
import { Router } from './Router';
import { RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { ProducerScore } from '../common/types';
import { Logger, skipIfClosed } from 'edumeet-common';
import { MediaKind } from 'edumeet-common';
import MediaNode from './MediaNode';

const logger = new Logger('Producer');

export interface ProducerOptions {
	id: string;
}

interface InternalProducerOptions extends ProducerOptions {
	router: Router;
	mediaNode: MediaNode;
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
	public mediaNode: MediaNode;
	public id: string;
	public kind: MediaKind;
	public paused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	public score?: ProducerScore[];

	constructor({
		router,
		mediaNode,
		id,
		kind,
		paused = false,
		rtpParameters,
		appData = {},
	}: InternalProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.kind = kind;
		this.paused = paused;
		this.rtpParameters = rtpParameters;
		this.appData = appData;

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
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

		this.mediaNode.once('close', () => this.close(true));
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

		await this.mediaNode.request({
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

		await this.mediaNode.request({
			method: 'resumeProducer',
			data: {
				routerId: this.router.id,
				producerId: this.id,
			}
		});

		this.paused = false;
	}
}