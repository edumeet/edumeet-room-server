import EventEmitter from 'events';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Router } from './Router';
import { Logger, Middleware, skipIfClosed } from 'edumeet-common';
import { SctpStreamParameters } from 'mediasoup-client/lib/SctpParameters';
import { createPipeDataProducerMiddleware } from '../middlewares/pipeDataProducerMiddleware';

const logger = new Logger('PipeDataProducer');

export interface PipeDataProducerOptions {
	id: string;
}

interface InternalPipeDataProducerOptions extends PipeDataProducerOptions {
	router: Router;
	connection: MediaNodeConnection;
	sctpStreamParameters: SctpStreamParameters;
	label?: string;
	protocol?: string;
	appData?: Record<string, unknown>;
}

export declare interface PipeDataProducer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class PipeDataProducer extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public sctpStreamParameters: SctpStreamParameters;
	public label?: string;
	public protocol?: string;
	public appData: Record<string, unknown>;

	private pipeDataProducerMiddleware: Middleware<MediaNodeConnectionContext>;

	constructor({
		router,
		connection,
		id,
		sctpStreamParameters,
		label,
		protocol,
		appData = {},
	}: InternalPipeDataProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.sctpStreamParameters = sctpStreamParameters;
		this.label = label;
		this.protocol = protocol;
		this.appData = appData;

		this.pipeDataProducerMiddleware =
			createPipeDataProducerMiddleware({ pipeDataProducer: this });

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		this.connection.pipeline.remove(this.pipeDataProducerMiddleware);

		if (!remoteClose) {
			this.connection.notify({
				method: 'closePipeDataProducer',
				data: {
					routerId: this.router.id,
					pipeDataProducerId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close());

		this.connection.pipeline.use(this.pipeDataProducerMiddleware);
	}
}