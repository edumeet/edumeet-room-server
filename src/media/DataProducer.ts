import { EventEmitter } from 'events';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Router } from './Router';
import { Logger, Middleware, skipIfClosed } from 'edumeet-common';
import { SctpStreamParameters } from 'mediasoup-client/lib/SctpParameters';
import { createDataProducerMiddleware } from '../middlewares/dataProducerMiddleware';

const logger = new Logger('DataProducer');

export interface DataProducerOptions {
	id: string;
}

interface InternalDataProducerOptions extends DataProducerOptions {
	router: Router;
	connection: MediaNodeConnection;
	sctpStreamParameters: SctpStreamParameters;
	label?: string;
	protocol?: string;
	appData?: Record<string, unknown>;
}

export declare interface DataProducer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class DataProducer extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public sctpStreamParameters: SctpStreamParameters;
	public label?: string;
	public protocol?: string;
	public appData: Record<string, unknown>;

	private dataProducerMiddleware: Middleware<MediaNodeConnectionContext>;

	constructor({
		router,
		connection,
		id,
		sctpStreamParameters,
		label,
		protocol,
		appData = {},
	}: InternalDataProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.sctpStreamParameters = sctpStreamParameters;
		this.label = label;
		this.protocol = protocol;
		this.appData = appData;

		this.dataProducerMiddleware = createDataProducerMiddleware({ dataProducer: this });

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		this.connection.pipeline.remove(this.dataProducerMiddleware);

		if (!remoteClose) {
			this.connection.notify({
				method: 'closeDataProducer',
				data: {
					routerId: this.router.id,
					dataProducerId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close());

		this.connection.pipeline.use(this.dataProducerMiddleware);
	}
}