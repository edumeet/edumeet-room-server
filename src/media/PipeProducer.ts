import { EventEmitter } from 'events';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router } from './Router';
import { RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { Logger, skipIfClosed } from 'edumeet-common';
import { MediaKind } from 'edumeet-common';

const logger = new Logger('PipeProducer');

export interface PipeProducerOptions {
	id: string;
}

interface InternalPipeProducerOptions extends PipeProducerOptions {
	router: Router;
	connection: MediaNodeConnection;
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
	public connection: MediaNodeConnection;
	public id: string;
	public kind: MediaKind;
	public paused: boolean;
	public rtpParameters: RtpParameters;
	public appData: Record<string, unknown>;

	constructor({
		router,
		connection,
		id,
		kind,
		paused = false,
		rtpParameters,
		appData = {},
	}: InternalPipeProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
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
			this.connection.notify({
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
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));
	}

	@skipIfClosed
	public async pause(): Promise<void> {
		logger.debug('pause()');

		await this.connection.request({
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

		await this.connection.request({
			method: 'resumePipeProducer',
			data: {
				routerId: this.router.id,
				pipeProducerId: this.id,
			}
		});
	}
}