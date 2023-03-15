import { EventEmitter } from 'events';
import { MediaNodeConnection } from './MediaNodeConnection';
import { WebRtcTransport, WebRtcTransportOptions } from './WebRtcTransport';
import { PipeTransport, PipeTransportOptions } from './PipeTransport';
import { PipeProducer } from './PipeProducer';
import { PipeConsumer } from './PipeConsumer';
import { SctpCapabilities } from 'mediasoup-client/lib/SctpParameters';
import { RtpCapabilities } from 'mediasoup-client/lib/RtpParameters';
import MediaNode from './MediaNode';
import { Logger, skipIfClosed } from 'edumeet-common';
import { PipeDataProducer } from './PipeDataProducer';
import { PipeDataConsumer } from './PipeDataConsumer';
import { Producer } from './Producer';
import { DataProducer } from './DataProducer';
import { Consumer } from './Consumer';
import { DataConsumer } from './DataConsumer';

const logger = new Logger('Router');

interface CreateWebRtcTransportOptions {
	forceTcp?: boolean;
	producing?: boolean;
	consuming?: boolean;
	sctpCapabilities?: SctpCapabilities;
	appData?: Record<string, unknown>;
}

interface CreatePipeTransportOptions {
	internal?: boolean;
	appData?: Record<string, unknown>;
}

export interface RouterOptions {
	id: string;
	rtpCapabilities: RtpCapabilities;
}

export interface PipeToRouterResult {
	pipeConsumer?: PipeConsumer;
	pipeProducer?: PipeProducer;
	pipeDataConsumer?: PipeDataConsumer;
	pipeDataProducer?: PipeDataProducer;
}

interface InternalRouterOptions extends RouterOptions {
	mediaNode: MediaNode;
	connection: MediaNodeConnection;
	appData?: Record<string, unknown>;
}

type PipeTransportPair = {
	[key: string]: PipeTransport;
};

export declare interface Router {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

export class Router extends EventEmitter {
	public closed = false;
	public mediaNode: MediaNode;
	public connection: MediaNodeConnection;
	public id: string;
	public rtpCapabilities: RtpCapabilities;
	public appData: Record<string, unknown>;
	public webRtcTransports: Map<string, WebRtcTransport> = new Map();
	public pipeTransports: Map<string, PipeTransport> = new Map();
	public producers: Map<string, Producer> = new Map();
	public pipeProducers: Map<string, PipeProducer> = new Map();
	public dataProducers: Map<string, DataProducer> = new Map();
	public pipeDataProducers: Map<string, PipeDataProducer> = new Map();
	public consumers: Map<string, Consumer> = new Map();
	public pipeConsumers: Map<string, PipeConsumer> = new Map();
	public dataConsumers: Map<string, DataConsumer> = new Map();
	public pipeDataConsumers: Map<string, PipeDataConsumer> = new Map();

	// Mapped by remote routerId
	public routerPipePromises = new Map<string, Promise<PipeTransportPair>>();

	constructor({
		mediaNode,
		connection,
		id,
		rtpCapabilities,
		appData = {}
	}: InternalRouterOptions) {
		logger.debug('constructor()');

		super();

		this.mediaNode = mediaNode;
		this.connection = connection;
		this.id = id;
		this.rtpCapabilities = rtpCapabilities;
		this.appData = appData;

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false) {
		logger.debug('close()');

		this.closed = true;

		if (!remoteClose) {
			this.connection.notify({
				method: 'closeRouter',
				data: { routerId: this.id }
			});
		}

		this.webRtcTransports.forEach((transport) => transport.close(true));
		this.pipeTransports.forEach((transport) => transport.close(true));

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));
	}

	@skipIfClosed
	public async canConsume({
		producerId,
		rtpCapabilities
	}: { producerId: string, rtpCapabilities: RtpCapabilities }): Promise<boolean> {
		logger.debug('canConsume()');

		const { canConsume } = await this.connection.request({
			method: 'canConsume',
			data: {
				routerId: this.id,
				producerId,
				rtpCapabilities,
			}
		}) as { canConsume: boolean };

		return canConsume;
	}

	@skipIfClosed
	public async createWebRtcTransport({
		forceTcp,
		sctpCapabilities,
		appData = {}
	}: CreateWebRtcTransportOptions): Promise<WebRtcTransport> {
		logger.debug('createWebRtcTransport()');

		const {
			id,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			sctpParameters,
		} = await this.connection.request({
			method: 'createWebRtcTransport',
			data: {
				routerId: this.id,
				forceTcp,
				sctpCapabilities,
			}
		}) as WebRtcTransportOptions;

		const transport = new WebRtcTransport({
			router: this,
			connection: this.connection,
			id,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			sctpParameters,
			appData,
		});

		this.webRtcTransports.set(id, transport);
		transport.once('close', () => this.webRtcTransports.delete(id));

		return transport;
	}

	@skipIfClosed
	public async createPipeTransport({
		internal,
		appData = {}
	}: CreatePipeTransportOptions = { appData: {} }): Promise<PipeTransport> {
		logger.debug('createPipeTransport()');

		const {
			id,
			ip,
			port,
			srtpParameters,
		} = await this.connection.request({
			method: 'createPipeTransport',
			data: { routerId: this.id, internal }
		}) as PipeTransportOptions;

		const transport = new PipeTransport({
			router: this,
			connection: this.connection,
			id,
			ip,
			port,
			srtpParameters,
			appData,
		});

		this.pipeTransports.set(id, transport);
		transport.once('close', () => this.pipeTransports.delete(id));

		return transport;
	}

	@skipIfClosed
	public async pipeToRouter({
		producerId,
		dataProducerId,
		router
	}: {
		producerId?: string;
		dataProducerId?: string;
		router: Router;
	}): Promise<PipeToRouterResult> {
		logger.debug('pipeToRouter()');

		if (!producerId && !dataProducerId)
			throw new Error('missing producerId or dataProducerId');
		if (producerId && dataProducerId)
			throw new Error('both producerId and dataProducerId given');

		let producer: Producer | PipeProducer | undefined;
		let dataProducer: DataProducer | PipeDataProducer | undefined;

		if (producerId) {
			producer =
				this.producers.get(producerId) ??
				this.pipeProducers.get(producerId);

			if (!producer)
				throw new TypeError('Producer not found');
		} else if (dataProducerId) {
			dataProducer =
				this.dataProducers.get(dataProducerId) ??
				this.pipeDataProducers.get(dataProducerId);

			if (!dataProducer)
				throw new TypeError('DataProducer not found');
		}

		const pipeTransportPairKey = router.id;

		let pipeTransportPairPromise = this.routerPipePromises.get(router.id);
		let pipeTransportPair: PipeTransportPair;
		let localPipeTransport: PipeTransport;
		let remotePipeTransport: PipeTransport;

		let internal = false;

		if (this.mediaNode === router.mediaNode)
			internal = true;

		if (pipeTransportPairPromise) {
			pipeTransportPair = await pipeTransportPairPromise;
			localPipeTransport = pipeTransportPair[this.id];
			remotePipeTransport = pipeTransportPair[router.id];
		} else {
			pipeTransportPairPromise = new Promise((resolve, reject) => {
				Promise.all([
					this.createPipeTransport({ internal }),
					router.createPipeTransport({ internal })
				])
					.then((pipeTransports) => {
						localPipeTransport = pipeTransports[0];
						remotePipeTransport = pipeTransports[1];
					})
					.then(() => {
						return Promise.all([
							localPipeTransport.connect({
								ip: remotePipeTransport.ip,
								port: remotePipeTransport.port,
								srtpParameters: remotePipeTransport.srtpParameters
							}),
							remotePipeTransport.connect({
								ip: localPipeTransport.ip,
								port: localPipeTransport.port,
								srtpParameters: localPipeTransport.srtpParameters
							})
						]);
					})
					.then(() => {
						localPipeTransport.once('close', () => {
							remotePipeTransport.close();
							this.routerPipePromises.delete(pipeTransportPairKey);
						});

						remotePipeTransport.once('close', () => {
							localPipeTransport.close();
							this.routerPipePromises.delete(pipeTransportPairKey);
						});

						resolve({
							[this.id]: localPipeTransport,
							[router.id]: remotePipeTransport
						});
					})
					.catch((error) => {
						logger.error(
							'pipeToRouter() | error creating PipeTransport pair:%o',
							error);

						if (localPipeTransport)
							localPipeTransport.close();

						if (remotePipeTransport)
							remotePipeTransport.close();

						reject(error);
					});
			});

			this.routerPipePromises.set(pipeTransportPairKey, pipeTransportPairPromise);
			router.addPipeTransportPair(this.id, pipeTransportPairPromise);
			await pipeTransportPairPromise;
		}

		if (producer) {
			let pipeConsumer: PipeConsumer | undefined;
			let pipeProducer: PipeProducer | undefined;

			try {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				pipeConsumer = await localPipeTransport!.consume({
					producerId: producer.id
				});

				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				pipeProducer = await remotePipeTransport!.produce({
					producerId: producer.id,
					kind: pipeConsumer.kind,
					rtpParameters: pipeConsumer.rtpParameters,
					paused: pipeConsumer.producerPaused,
					appData: producer.appData
				});

				// Ensure that the producer has not been closed in the meanwhile.
				if (producer.closed)
					throw new Error('original Producer closed');

				// Ensure that producer.paused has not changed in the meanwhile and, if
				// so, sync the pipeProducer.
				if (pipeProducer.paused !== producer.paused) {
					if (producer.paused)
						await pipeProducer.pause();
					else
						await pipeProducer.resume();
				}

				// Pipe events from the pipe Consumer to the pipe Producer.
				pipeConsumer.once('close', () => pipeProducer?.close());
				pipeConsumer.on('producerpause', async () => await pipeProducer?.pause());
				pipeConsumer.on('producerresume', async () => await pipeProducer?.resume());

				// Pipe events from the pipe Producer to the pipe Consumer.
				pipeProducer.once('close', () => pipeConsumer?.close());

				return { pipeConsumer, pipeProducer };
			} catch (error) {
				logger.error(
					'pipeToRouter() | error creating pipe Consumer/Producer pair:%o',
					error);

				if (pipeConsumer)
					pipeConsumer.close();

				if (pipeProducer)
					pipeProducer.close();

				throw error;
			}
		} else if (dataProducer) {
			let pipeDataConsumer: PipeDataConsumer | undefined;
			let pipeDataProducer: PipeDataProducer | undefined;

			try {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				pipeDataConsumer = await localPipeTransport!.consumeData({
					dataProducerId: dataProducer.id
				});

				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				pipeDataProducer = await remotePipeTransport!.produceData({
					dataProducerId: dataProducer.id,
					sctpStreamParameters: pipeDataConsumer.sctpStreamParameters,
					label: pipeDataConsumer.label,
					protocol: pipeDataConsumer.protocol,
					appData: dataProducer?.appData
				});

				// Ensure that the dataProducer has not been closed in the meanwhile.
				if (dataProducer.closed)
					throw new Error('original DataProducer closed');

				// Pipe events from the pipe Consumer to the pipe DataProducer.
				pipeDataConsumer.once('close', () => pipeDataProducer?.close());

				// Pipe events from the pipe DataProducer to the pipe Consumer.
				pipeDataProducer.once('close', () => pipeDataConsumer?.close());

				return { pipeDataConsumer, pipeDataProducer };
			} catch (error) {
				logger.error(
					'pipeToRouter() | error creating pipe Consumer/DataProducer pair:%o',
					error);

				if (pipeDataConsumer)
					pipeDataConsumer.close();

				if (pipeDataProducer)
					pipeDataProducer.close();

				throw error;
			}
		} else {
			throw new Error('Internal error');
		}
	}

	@skipIfClosed
	private addPipeTransportPair(
		pipeTransportPairKey: string,
		pipeTransportPairPromise: Promise<PipeTransportPair>
	): void {
		if (this.routerPipePromises.has(pipeTransportPairKey)) {
			throw new Error(
				'given pipeTransportPairKey already exists in this Router');
		}

		this.routerPipePromises.set(pipeTransportPairKey, pipeTransportPairPromise);
		pipeTransportPairPromise.then((pipeTransportPair) => {
			const localPipeTransport = pipeTransportPair[this.id];

			// NOTE: No need to do any other cleanup here since that is done by the
			// Router calling this method on us.
			localPipeTransport.once('close', () => {
				this.routerPipePromises.delete(pipeTransportPairKey);
			});
		}).catch(() => {
			this.routerPipePromises.delete(
				pipeTransportPairKey);
		});
	}
}