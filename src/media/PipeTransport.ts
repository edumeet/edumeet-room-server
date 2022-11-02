import EventEmitter from 'events';
import { Logger } from '../common/logger';
import { skipIfClosed } from '../common/decorators';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Router } from './Router';
import { SrtpParameters } from 'mediasoup/node/lib/SrtpParameters';
import { PipeConsumer, PipeConsumerOptions } from './PipeConsumer';
import { PipeProducer, PipeProducerOptions } from './PipeProducer';
import { MediaKind, RtpParameters } from 'mediasoup/node/lib/RtpParameters';
import { Middleware } from '../common/middleware';
import { createPipeTransportMiddleware } from '../middlewares/pipeTransportMiddleware';

const logger = new Logger('PipeTransport');

interface PipeProduceOptions {
	producerId: string;
	kind: MediaKind;
	paused?: boolean;
	rtpParameters: RtpParameters;
	appData?: Record<string, unknown>;
}

interface PipeConsumeOptions {
	producerId: string;
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
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.connection.pipeline.remove(this.pipeTransportMiddleware);
		this.pipeConsumers.forEach((pipeConsumer) => pipeConsumer.close(true));
		this.pipeProducers.forEach((pipeProducer) => pipeProducer.close(true));

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.on('close', () => this.close());

		this.connection.pipeline.use(this.pipeTransportMiddleware);
	}

	@skipIfClosed
	public async connect({
		ip,
		port,
		srtpParameters
	}: { ip: string; port: number; srtpParameters: SrtpParameters }): Promise<void> {
		logger.debug('connect()');

		await this.connection.notify({
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
				appData
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
}