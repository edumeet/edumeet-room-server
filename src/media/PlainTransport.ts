import { EventEmitter } from 'events';
import { Producer, ProducerOptions } from './Producer';
import { Consumer, ConsumerOptions } from './Consumer';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { DataProducer, DataProducerOptions } from './DataProducer';
import { DataConsumer, DataConsumerOptions } from './DataConsumer';
import { MediaKind } from 'edumeet-common';
import { MediaNode } from './MediaNode';
import { RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/RtpParameters';
import { SctpParameters, SctpStreamParameters } from 'mediasoup/node/lib/SctpParameters';
import { SrtpParameters } from 'mediasoup/node/lib/SrtpParameters';
import { TransportTuple } from 'mediasoup/node/lib/Transport';

const logger = new Logger('PlainTransport');

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

export interface PlainTransportOptions {
	id: string;
	tuple: TransportTuple;
	rtcpTuple?: TransportTuple;
	sctpParameters?: SctpParameters;
	rtcpMux?: boolean;
	comedia?: boolean;
	srtpParameters?: SrtpParameters;
}

interface InternalPlainTransportOptions extends PlainTransportOptions {
	router: Router;
	mediaNode: MediaNode;
	appData?: Record<string, unknown>;
}

export declare interface PlainTransport {
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
	on(event: 'tuple', listener: (tuple: TransportTuple) => void): this;
	on(event: 'rtcptuple', listener: (tuple: TransportTuple) => void): this;
	on(event: 'sctpstatechange', listener: (sctpState: string) => void): this;
}

export class PlainTransport extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public tuple: TransportTuple;
	public rtcpTuple?: TransportTuple;
	public sctpParameters?: SctpParameters;
	public rtcpMux?: boolean;
	public comedia?: boolean;
	public srtpParameters?: SrtpParameters;
	public appData: Record<string, unknown>;

	public consumers: Map<string, Consumer> = new Map();
	public producers: Map<string, Producer> = new Map();

	public dataConsumers: Map<string, DataConsumer> = new Map();
	public dataProducers: Map<string, DataProducer> = new Map();

	constructor({
		router,
		mediaNode,
		id,
		tuple,
		rtcpTuple,
		sctpParameters,
		rtcpMux,
		comedia,
		srtpParameters,
		appData = {},
	}: InternalPlainTransportOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.tuple = tuple;
		this.rtcpTuple = rtcpTuple;
		this.sctpParameters = sctpParameters;
		this.rtcpMux = rtcpMux;
		this.comedia = comedia;
		this.srtpParameters = srtpParameters;
		this.appData = appData;
	}

	@skipIfClosed
	public close(remoteClose = false) {
		logger.debug('close()');

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
				method: 'closePlainTransport',
				data: {
					routerId: this.router.id,
					transportId: this.id,
				}
			});
		}

		this.consumers.forEach((consumer) => consumer.close(true));
		this.producers.forEach((producer) => producer.close(true));
		this.dataConsumers.forEach((dataConsumer) => dataConsumer.close(true));
		this.dataProducers.forEach((dataProducer) => dataProducer.close(true));

		this.emit('close', remoteClose);
	}

	@skipIfClosed
	public async connect({
		ip,
		port,
		rtcpPort,
		srtpParameters
	}: { 
		ip?: string; 
		port?: number; 
		rtcpPort?: number; 
		srtpParameters?: SrtpParameters 
	}) {
		logger.debug('connect()');

		await this.mediaNode.request({
			method: 'connectPlainTransport',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				ip,
				port,
				rtcpPort,
				srtpParameters,
			}
		});
	}

	@skipIfClosed
	public async setMaxIncomingBitrate(bitrate: number): Promise<void> {
		logger.debug('setMaxIncomingBitrate()');

		await this.mediaNode.request({
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

		const { id } = await this.mediaNode.request({
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
			mediaNode: this.mediaNode,
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
		} = await this.mediaNode.request({
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
			mediaNode: this.mediaNode,
			id,
			producerId,
			kind,
			paused,
			producerPaused,
			rtpParameters,
			appData,
		});

		this.consumers.set(id, consumer);
		this.router.consumers.set(id, consumer);
		consumer.once('close', () => {
			this.consumers.delete(id);
			this.router.consumers.delete(id);
		});

		return consumer;
	}

	@skipIfClosed
	public async produceData({
		sctpStreamParameters,
		label,
		protocol,
		appData = {},
	}: DataProduceOptions): Promise<DataProducer> {
		logger.debug('produceData()');

		const { id } = await this.mediaNode.request({
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
			mediaNode: this.mediaNode,
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
		} = await this.mediaNode.request({
			method: 'consumeData',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				dataProducerId,
			}
		}) as DataConsumerOptions;

		const dataConsumer = new DataConsumer({
			router: this.router,
			mediaNode: this.mediaNode,
			id,
			dataProducerId,
			sctpStreamParameters,
			label,
			protocol,
			appData,
		});

		this.dataConsumers.set(id, dataConsumer);
		this.router.dataConsumers.set(id, dataConsumer);
		dataConsumer.once('close', () => {
			this.dataConsumers.delete(id);
			this.router.dataConsumers.delete(id);
		});

		return dataConsumer;
	}

	@skipIfClosed
	public async getStats() {
		logger.debug('getStats()');

		return await this.mediaNode.request({
			method: 'getPlainTransportStats',
			data: {
				routerId: this.router.id,
				transportId: this.id,
			}
		});
	}
}
