import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import MediaNode from './MediaNode';
import { SctpStreamParameters } from 'mediasoup/node/lib/SctpParameters';

const logger = new Logger('PipeDataConsumer');

export interface PipeDataConsumerOptions {
	id: string;
	sctpStreamParameters: SctpStreamParameters;
	label?: string;
	protocol?: string;
}

interface InternalPipeDataConsumerOptions extends PipeDataConsumerOptions {
	router: Router;
	mediaNode: MediaNode;
	dataProducerId: string;
	appData?: Record<string, unknown>;
}

export declare interface PipeDataConsumer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class PipeDataConsumer extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public dataProducerId: string;
	public sctpStreamParameters: SctpStreamParameters;
	public label?: string;
	public protocol?: string;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		dataProducerId,
		sctpStreamParameters,
		label,
		protocol,
		appData = {},
	}: InternalPipeDataConsumerOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.dataProducerId = dataProducerId;
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
				method: 'closePipeDataConsumer',
				data: {
					routerId: this.router.id,
					pipeDataConsumerId: this.id,
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
}