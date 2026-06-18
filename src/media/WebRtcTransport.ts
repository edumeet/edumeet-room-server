import { EventEmitter } from 'events';
import { Producer, ProducerOptions } from './Producer';
import { Consumer, ConsumerOptions } from './Consumer';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { DataProducer, DataProducerOptions } from './DataProducer';
import { DataConsumer, DataConsumerOptions } from './DataConsumer';
import { MediaKind } from 'edumeet-common';
import { MediaNode } from './MediaNode';
import { DtlsParameters, IceCandidate, IceParameters, RtpCapabilities, RtpParameters, SctpParameters, SctpStreamParameters } from 'mediasoup/types';

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
	mediaNode: MediaNode;
	appData?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface WebRtcTransport {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class WebRtcTransport extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
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

	// Idempotency guards: a client whose request ack timed out (slow round-trip
	// under load) re-sends the identical request. Socket.IO's ack timeout does not
	// cancel the work already done, so the duplicate would re-run connect/produce on
	// the media node, which throws ("connect() already called", "ssrc/MID already
	// exists") and breaks the peer's media. We dedupe so retries resolve to the
	// original result instead.
	//
	// produce dedupe is keyed by the track's msid (falling back to the SSRC set), NOT
	// the mid: mediasoup-client recycles a closed m-section's mid for a later producer
	// (versatica/mediasoup-client #363), so mid is not a stable per-producer identity.
	// SSRC alone is insufficient because RID-based simulcast carries no SSRC in its
	// encodings — only msid is present for every media type (audio, SVC, SSRC- and
	// RID-simulcast). A retry re-sends the same msid; a new track always gets a new one.
	#connectPromise?: Promise<void>;
	public producePromises: Map<string, Promise<Producer>> = new Map();

	constructor({
		router,
		mediaNode,
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
		this.mediaNode = mediaNode;
		this.id = id;
		this.iceParameters = iceParameters;
		this.iceCandidates = iceCandidates;
		this.dtlsParameters = dtlsParameters;
		this.sctpParameters = sctpParameters;
		this.appData = appData;
	}

	@skipIfClosed
	public close(remoteClose = false) {
		logger.debug('close()');

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
				method: 'closeWebRtcTransport',
				data: {
					routerId: this.router.id,
					transportId: this.id,
				}
			});
		}

		this.consumers.forEach((consumer) => consumer.close(true));
		this.producers.forEach((producer) => producer.close(true));

		this.emit('close', remoteClose);
	}

	@skipIfClosed
	public async connect({
		dtlsParameters
	}: { dtlsParameters: DtlsParameters }) {
		logger.debug('connect()');

		// Idempotent: reuse the first connect so a retried (duplicate) connect for the
		// same transport awaits the original instead of hitting "connect() already
		// called" on the media node. Cleared on failure so a genuine retry can proceed.
		if (this.#connectPromise) return this.#connectPromise;

		this.#connectPromise = this.mediaNode.request({
			method: 'connectWebRtcTransport',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				dtlsParameters,
			}
		}).then(() => undefined);

		try {
			await this.#connectPromise;
		} catch (error) {
			this.#connectPromise = undefined;
			throw error;
		}
	}

	@skipIfClosed
	public async restartIce(): Promise<unknown> {
		logger.debug('restartIce()');

		const { iceParameters } = await this.mediaNode.request({
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

		await this.mediaNode.request({
			method: 'setMaxIncomingBitrate',
			data: {
				routerId: this.router.id,
				transportId: this.id,
				bitrate,
			}
		});
	}

	// Idempotent produce: a retried produce (same track identity) resolves to the
	// ORIGINAL producer with reused=true, so the caller can skip its side effects
	// (consumer fan-out, listeners) instead of double-running them. A brand-new track —
	// even one reusing a recycled mid — has a new identity and makes a new producer.
	@skipIfClosed
	public async produceDeduped(options: ProduceOptions): Promise<{ producer: Producer; reused: boolean }> {
		const key = WebRtcTransport.produceKey(options.rtpParameters);

		if (key) {
			const existing = this.producePromises.get(key);

			if (existing) return { producer: await existing, reused: true };
		}

		const promise = this.produce(options);

		if (key) {
			this.producePromises.set(key, promise);

			promise.then((producer) => {
				producer.once('close', () => {
					if (this.producePromises.get(key) === promise) this.producePromises.delete(key);
				});
			}).catch(() => {
				if (this.producePromises.get(key) === promise) this.producePromises.delete(key);
			});
		}

		return { producer: await promise, reused: false };
	}

	// Stable per-producer identity for dedupe. Prefer the track's msid (present for all
	// media types incl. RID-based simulcast, which has no SSRC); fall back to the sorted
	// SSRC set if a client omits msid; undefined → no dedupe (safe: original behaviour).
	private static produceKey(rtpParameters: RtpParameters): string | undefined {
		const { msid } = rtpParameters as { msid?: string };

		if (typeof msid === 'string' && msid.length > 0) return `msid:${msid}`;

		const ssrcs = (rtpParameters.encodings ?? [])
			.map((encoding) => encoding.ssrc)
			.filter((ssrc): ssrc is number => typeof ssrc === 'number')
			.sort((a, b) => a - b);

		return ssrcs.length > 0 ? `ssrc:${ssrcs.join(',')}` : undefined;
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
		logger.debug('produce()');

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
}
