import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { MediaNode } from './MediaNode';
import { SctpStreamParameters } from 'mediasoup/types';

const logger = new Logger('DataConsumer');

export interface DataConsumerOptions {
	id: string;
	sctpStreamParameters: SctpStreamParameters;
	label?: string;
	protocol?: string;
}

interface InternalDataConsumerOptions extends DataConsumerOptions {
	router: Router;
	mediaNode: MediaNode;
	dataProducerId: string;
	appData?: Record<string, unknown>;
}

export declare interface DataConsumer {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
}

export class DataConsumer extends EventEmitter {
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
	}: InternalDataConsumerOptions) {
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
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
				method: 'closeDataConsumer',
				data: {
					routerId: this.router.id,
					dataConsumerId: this.id,
				}
			});
		}

		this.emit('close', remoteClose);
	}
}
