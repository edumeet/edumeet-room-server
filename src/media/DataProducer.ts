import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import MediaNode from './MediaNode';
import { SctpStreamParameters } from 'mediasoup/node/lib/SctpParameters';

const logger = new Logger('DataProducer');

export interface DataProducerOptions {
	id: string;
}

interface InternalDataProducerOptions extends DataProducerOptions {
	router: Router;
	mediaNode: MediaNode;
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
	public mediaNode: MediaNode;
	public id: string;
	public sctpStreamParameters: SctpStreamParameters;
	public label?: string;
	public protocol?: string;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		sctpStreamParameters,
		label,
		protocol,
		appData = {},
	}: InternalDataProducerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.sctpStreamParameters = sctpStreamParameters;
		this.label = label;
		this.protocol = protocol;
		this.appData = appData;

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
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

		this.mediaNode.once('close', () => this.close());
	}
}