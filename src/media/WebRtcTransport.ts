import EventEmitter from 'events';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { Producer, ProducerOptions } from './Producer';
import { Consumer, ConsumerOptions } from './Consumer';
import { Router } from './Router';
import { createWebRtcTransportMiddleware } from '../middlewares/webRtcTransportMiddleware';
import { RtpCapabilities, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { DtlsParameters, IceCandidate, IceParameters } from 'mediasoup-client/lib/Transport';
import { SctpParameters, SctpStreamParameters } from 'mediasoup-client/lib/SctpParameters';
import { Logger, Middleware, skipIfClosed } from 'edumeet-common';
import { DataProducer, DataProducerOptions } from './DataProducer';
import { DataConsumer, DataConsumerOptions } from './DataConsumer';
import { MediaKind } from 'edumeet-common';
type MediaKind = typeof MediaKind[keyof typeof MediaKind];

const logger = new Logger('WebRtcTransport');

interface ProduceOptions {
	kind: MediaKind;
	paused?: boolean;
	rtpParameters: RtpParameters;
	appData?: Record<string, unknown>;
}

interface DataProduceOptions {
	sctpStreamParameters: SctpStreamParameters;
	label?: string;
	protocol?: string;
	appData?: Record<string, unknown>;
}

interface ConsumeOptions {
	producerId: string;
	rtpCapabilities: RtpCapabilities;
	appData?: Record<string, unknown>;
}

interface DataConsumeOptions {
	dataProducerId: string;
	appData?: Record<string, unknown>;
}

export interface WebRtcTransportOptions {
	id: string;
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	dtlsParameters: DtlsParameters;
	sctpParameters: SctpParameters;
}

interface InternalWebRtcTransportOptions extends WebRtcTransportOptions {
	router: Router;
	connection: MediaNodeConnection;
	appData?: Record<string, unknown>;
}

export declare interface WebRtcTransport {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class WebRtcTransport extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public iceParameters: IceParameters;
	public iceCandidates: IceCandidate[];
	public dtlsParameters: DtlsParameters;
	public sctpParameters: SctpParameters;
	public appData: Record<string, unknown>;

	public consumers: Map<string, Consumer> = new Map();
	public producers: Map<string, Producer> = new Map();

	public dataConsumers: Map<string, DataConsumer> = new Map();
	public dataProducers: Map<string, DataProducer> = new Map();

	private webRtcTransportMiddleware: Middleware<MediaNodeConnectionContext>;

	constructor({
		router,
		connection,
		id,
		iceParameters,
		iceCandidates,
		dtlsParameters,
		sctpParameters,
		appData = {},
	}: InternalWebRtcTransportOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.iceParameters = iceParameters;
		this.iceCandidates = iceCandidates;
		this.dtlsParameters = dtlsParameters;
		this.sctpParameters = sctpParameters;
		this.appData = appData;

		this.webRtcTransportMiddleware = createWebRtcTransportMiddleware({
			webRtcTransport: this
		});

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false) {
		logger.debug('close()');

		this.closed = true;

		this.connection.pipeline.remove(this.webRtcTransportMiddleware);

		if (!remoteClose) {
			this.connection.notify({
				method: 'closeWebRtcTransport',
				data: {
					routerId: this.router.id,
					transportId: this.id,
				}
			});
		}

		this.consumers.forEach((consumer) => consumer.close(true));
		this.producers.forEach((producer) => producer.close(true));

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));

		this.connection.pipeline.use(this.webRtcTransportMiddleware);
	}

	@skipIfClosed
	public async connect({
		dtlsParameters
	}: { dtlsParameters: DtlsParameters }) {
		logger.debug('connect()');

		await this.connection.request({
			method: 'connectWebRtcTransport',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				dtlsParameters,
			}
		});
	}

	@skipIfClosed
	public async restartIce(): Promise<unknown> {
		logger.debug('restartIce()');

		const { iceParameters } = await this.connection.request({
			method: 'restartIce',
			data: {
				routerId: this.router.id,
				transportId: this.id,
			}
		}) as { iceParameters: IceParameters };

		this.iceParameters = iceParameters;

		return iceParameters;
	}

	@skipIfClosed
	public async setMaxIncomingBitrate(bitrate: number): Promise<void> {
		logger.debug('setMaxIncomingBitrate()');

		await this.connection.request({
			method: 'setMaxIncomingBitrate',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				bitrate,
			}
		});
	}

	@skipIfClosed
	public async produce({
		kind,
		paused,
		rtpParameters,
		appData = {},
	}: ProduceOptions): Promise<Producer> {
		logger.debug('produce()');

		const { id } = await this.connection.request({
			method: 'produce',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				kind,
				rtpParameters,
				paused,
			}
		}) as ProducerOptions;

		const producer = new Producer({
			router: this.router,
			connection: this.connection,
			id,
			kind,
			paused,
			rtpParameters,
			appData,
		});

		this.producers.set(id, producer);
		this.router.producers.set(id, producer);
		producer.once('close', () => {
			this.producers.delete(id);
			this.router.producers.delete(id);
		});

		return producer;
	}

	@skipIfClosed
	public async consume({
		producerId,
		rtpCapabilities,
		appData = {},
	}: ConsumeOptions): Promise<Consumer> {
		logger.debug('consume()');

		const {
			id,
			kind,
			paused,
			producerPaused,
			rtpParameters
		} = await this.connection.request({
			method: 'consume',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				producerId,
				rtpCapabilities,
			}
		}) as ConsumerOptions;

		const consumer = new Consumer({
			router: this.router,
			connection: this.connection,
			id,
			producerId,
			kind,
			paused,
			producerPaused,
			rtpParameters,
			appData,
		});

		this.consumers.set(id, consumer);
		consumer.once('close', () => this.consumers.delete(id));

		return consumer;
	}

	@skipIfClosed
	public async produceData({
		sctpStreamParameters,
		label,
		protocol,
		appData = {},
	}: DataProduceOptions): Promise<DataProducer> {
		logger.debug('produce()');

		const { id } = await this.connection.request({
			method: 'produceData',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				sctpStreamParameters,
				label,
				protocol,
			}
		}) as DataProducerOptions;

		const dataProducer = new DataProducer({
			router: this.router,
			connection: this.connection,
			id,
			sctpStreamParameters,
			label,
			protocol,
			appData,
		});

		this.dataProducers.set(id, dataProducer);
		this.router.dataProducers.set(id, dataProducer);
		dataProducer.once('close', () => {
			this.dataProducers.delete(id);
			this.router.dataProducers.delete(id);
		});

		return dataProducer;
	}

	@skipIfClosed
	public async consumeData({
		dataProducerId,
		appData = {},
	}: DataConsumeOptions): Promise<DataConsumer> {
		logger.debug('consumeData()');

		const {
			id,
			sctpStreamParameters,
			label,
			protocol,
		} = await this.connection.request({
			method: 'consumeData',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				dataProducerId,
			}
		}) as DataConsumerOptions;

		const dataConsumer = new DataConsumer({
			router: this.router,
			connection: this.connection,
			id,
			dataProducerId,
			sctpStreamParameters,
			label,
			protocol,
			appData,
		});

		this.dataConsumers.set(id, dataConsumer);
		dataConsumer.once('close', () => this.dataConsumers.delete(id));

		return dataConsumer;
	}
}