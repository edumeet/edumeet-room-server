import EventEmitter from 'events';
import { Logger } from '../common/logger';
import { skipIfClosed } from '../common/decorators';
import { MediaNodeConnection, MediaNodeConnectionContext } from './MediaNodeConnection';
import { DtlsParameters, IceCandidate, IceParameters } from 'mediasoup/node/lib/WebRtcTransport';
import { SctpParameters } from 'mediasoup/node/lib/SctpParameters';
import { Producer, ProducerOptions } from './Producer';
import { Consumer, ConsumerOptions } from './Consumer';
import { Router } from './Router';
import { MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/RtpParameters';
import { Middleware } from '../common/middleware';
import { createWebRtcTransportMiddleware } from '../middlewares/webRtcTransportMiddleware';

const logger = new Logger('WebRtcTransport');

interface ProduceOptions {
	kind: MediaKind;
	paused?: boolean;
	rtpParameters: RtpParameters;
	appData?: Record<string, unknown>;
}

interface ConsumeOptions {
	producerId: string;
	rtpCapabilities: RtpCapabilities;
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
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.connection.pipeline.remove(this.webRtcTransportMiddleware);
		this.consumers.forEach((consumer) => consumer.close(true));
		this.producers.forEach((producer) => producer.close(true));

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.on('close', () => this.close());

		this.connection.pipeline.use(this.webRtcTransportMiddleware);
	}

	@skipIfClosed
	public async connect({
		dtlsParameters
	}: { dtlsParameters: DtlsParameters }) {
		logger.debug('connect()');

		return this.connection.notify({
			method: 'connectWebRtcTransport',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				dtlsParameters,
			}
		});
	}

	@skipIfClosed
	public async restartIce() {
		logger.debug('restartIce()');

		return this.connection.request({
			method: 'restartIce',
			data: {
				routerId: this.router.id,
				transportId: this.id,
			}
		});
	}

	@skipIfClosed
	public async setMaxIncomingBitrate(bitrate: number): Promise<void> {
		logger.debug('setMaxIncomingBitrate()');

		return this.connection.notify({
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
}