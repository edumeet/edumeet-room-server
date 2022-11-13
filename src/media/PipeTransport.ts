import EventEmitter from 'events';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Router } from './Router';
import { PipeConsumer, PipeConsumerOptions } from './PipeConsumer';
import { PipeProducer, PipeProducerOptions } from './PipeProducer';
import { createPipeTransportMiddleware } from '../middlewares/pipeTransportMiddleware';
import { MediaKind, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { SrtpParameters } from '../common/types';
import { Logger, Middleware, skipIfClosed } from 'edumeet-common';
import { SctpStreamParameters } from 'mediasoup-client/lib/SctpParameters';
import { PipeDataProducer, PipeDataProducerOptions } from './PipeDataProducer';
import { PipeDataConsumer, PipeDataConsumerOptions } from './PipeDataConsumer';

const logger = new Logger('PipeTransport');

interface PipeProduceOptions {
	producerId: string;
	kind: MediaKind;
	paused?: boolean;
	rtpParameters: RtpParameters;
	appData?: Record<string, unknown>;
}

interface PipeDataProduceOptions {
	dataProducerId: string;
	sctpStreamParameters: SctpStreamParameters;
	label?: string;
	protocol?: string;
	appData?: Record<string, unknown>;
}

interface PipeConsumeOptions {
	producerId: string;
	appData?: Record<string, unknown>;
}

interface PipeDataConsumeOptions {
	dataProducerId: string;
	appData?: Record<string, unknown>;
}

export interface PipeTransportOptions {
	id: string;
	ip: string;
	port: number;
	srtpParameters: SrtpParameters;
}

interface InternalPipeTransportOptions extends PipeTransportOptions {
	router: Router;
	connection: MediaNodeConnection;
	appData?: Record<string, unknown>;
}

export declare interface PipeTransport {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class PipeTransport extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public ip: string;
	public port: number;
	public srtpParameters: SrtpParameters;
	public appData: Record<string, unknown>;

	public pipeConsumers: Map<string, PipeConsumer> = new Map();
	public pipeProducers: Map<string, PipeProducer> = new Map();

	public pipeDataConsumers: Map<string, PipeDataConsumer> = new Map();
	public pipeDataProducers: Map<string, PipeDataProducer> = new Map();

	private pipeTransportMiddleware: Middleware<MediaNodeConnectionContext>;

	constructor({
		router,
		connection,
		id,
		ip,
		port,
		srtpParameters,
		appData = {},
	}: InternalPipeTransportOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.ip = ip;
		this.port = port;
		this.srtpParameters = srtpParameters;
		this.appData = appData;

		this.pipeTransportMiddleware = createPipeTransportMiddleware({
			pipeTransport: this
		});

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false) {
		logger.debug('close()');

		this.closed = true;

		this.connection.pipeline.remove(this.pipeTransportMiddleware);

		if (!remoteClose) {
			this.connection.notify({
				method: 'closePipeTransport',
				data: {
					routerId: this.router.id,
					pipeTransportId: this.id
				}
			});
		}

		this.pipeConsumers.forEach((pipeConsumer) => pipeConsumer.close(true));
		this.pipeProducers.forEach((pipeProducer) => pipeProducer.close(true));

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));

		this.connection.pipeline.use(this.pipeTransportMiddleware);
	}

	@skipIfClosed
	public async connect({
		ip,
		port,
		srtpParameters
	}: { ip: string; port: number; srtpParameters: SrtpParameters }): Promise<void> {
		logger.debug('connect()');

		await this.connection.request({
			method: 'connectPipeTransport',
			data: {
				routerId: this.router.id,
				pipeTransportId: this.id,
				ip,
				port,
				srtpParameters
			}
		});
	}

	@skipIfClosed
	public async produce({
		producerId,
		kind,
		paused,
		rtpParameters,
		appData = {}
	}: PipeProduceOptions): Promise<PipeProducer> {
		logger.debug('produce()');

		const { id } = await this.connection.request({
			method: 'createPipeProducer',
			data: {
				routerId: this.router.id,
				pipeTransportId: this.id,
				producerId,
				kind,
				paused,
				rtpParameters,
			}
		}) as PipeProducerOptions;

		const pipeProducer = new PipeProducer({
			router: this.router,
			connection: this.connection,
			id,
			kind,
			paused,
			rtpParameters,
			appData,
		});

		this.pipeProducers.set(pipeProducer.id, pipeProducer);
		this.router.pipeProducers.set(pipeProducer.id, pipeProducer);
		pipeProducer.once('close', () => {
			this.pipeProducers.delete(pipeProducer.id);
			this.router.pipeProducers.delete(pipeProducer.id);
		});

		return pipeProducer;
	}

	@skipIfClosed
	public async consume({
		producerId,
		appData = {}
	}: PipeConsumeOptions): Promise<PipeConsumer> {
		logger.debug('consume()');

		const {
			id,
			kind,
			producerPaused,
			rtpParameters,
		} = await this.connection.request({
			method: 'createPipeConsumer',
			data: {
				routerId: this.router.id,
				pipeTransportId: this.id,
				producerId
			}
		}) as PipeConsumerOptions;

		const pipeConsumer = new PipeConsumer({
			router: this.router,
			connection: this.connection,
			id,
			producerId,
			kind,
			producerPaused,
			rtpParameters,
			appData,
		});

		this.pipeConsumers.set(pipeConsumer.id, pipeConsumer);
		pipeConsumer.once('close', () => this.pipeConsumers.delete(id));

		return pipeConsumer;
	}

	@skipIfClosed
	public async produceData({
		dataProducerId,
		sctpStreamParameters,
		label,
		protocol,
		appData = {}
	}: PipeDataProduceOptions): Promise<PipeDataProducer> {
		logger.debug('produceData()');

		const { id } = await this.connection.request({
			method: 'createPipeDataProducer',
			data: {
				routerId: this.router.id,
				pipeTransportId: this.id,
				dataProducerId,
				sctpStreamParameters,
				label,
				protocol,
			}
		}) as PipeDataProducerOptions;

		const pipeDataProducer = new PipeDataProducer({
			router: this.router,
			connection: this.connection,
			id,
			sctpStreamParameters,
			label,
			protocol,
			appData,
		});

		this.pipeDataProducers.set(pipeDataProducer.id, pipeDataProducer);
		this.router.pipeDataProducers.set(pipeDataProducer.id, pipeDataProducer);
		pipeDataProducer.once('close', () => {
			this.pipeDataProducers.delete(pipeDataProducer.id);
			this.router.pipeDataProducers.delete(pipeDataProducer.id);
		});

		return pipeDataProducer;
	}

	@skipIfClosed
	public async consumeData({
		dataProducerId,
		appData = {}
	}: PipeDataConsumeOptions): Promise<PipeDataConsumer> {
		logger.debug('consumeData()');

		const {
			id,
			sctpStreamParameters,
			label,
			protocol,
		} = await this.connection.request({
			method: 'createPipeDataConsumer',
			data: {
				routerId: this.router.id,
				pipeTransportId: this.id,
				dataProducerId,
			}
		}) as PipeDataConsumerOptions;

		const pipeDataConsumer = new PipeDataConsumer({
			router: this.router,
			connection: this.connection,
			id,
			dataProducerId,
			sctpStreamParameters,
			label,
			protocol,
			appData,
		});

		this.pipeDataConsumers.set(pipeDataConsumer.id, pipeDataConsumer);
		pipeDataConsumer.once('close', () => this.pipeDataConsumers.delete(id));

		return pipeDataConsumer;
	}
}