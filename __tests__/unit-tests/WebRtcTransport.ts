import 'jest';
import { Router } from '../../src/media/Router';
import { MediaNodeConnection } from '../../src/media/MediaNodeConnection';
import MediaNode from '../../src/media/MediaNode';
import { RtpCapabilities, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { WebRtcTransport } from '../../src/media/WebRtcTransport';
import { DtlsParameters, IceCandidate, IceParameters } from 'mediasoup-client/lib/Transport';
import { SctpParameters } from 'mediasoup-client/lib/SctpParameters';
import { MediaKind } from 'edumeet-common';

describe('WebRtcTransport', () => {
	let webRtcTransport: WebRtcTransport;

	const transportId = 'transportId';
	const iceParameters = {} as IceParameters;
	const iceCandidates = [] as IceCandidate[];
	const dtlsParameters = {} as DtlsParameters;
	const sctpParameters = {} as SctpParameters;
	const rtpCapabilities = {} as RtpCapabilities;

	const connection = {
		ready: Promise.resolve(),
		close: jest.fn(),
		notify: jest.fn(),
		request: jest.fn(),
		on: jest.fn(),
		once: jest.fn(),
		pipeline: {
			use: jest.fn(),
			remove: jest.fn(),
			execute: jest.fn(),
		},
	} as unknown as MediaNodeConnection;

	const mediaNode = new MediaNode({
		id: 'testId1',
		hostname: 'testHostname',
		port: 1234,
		secret: 'testSecret',
	});

	const router = new Router({
		mediaNode,
		connection,
		id: 'testId1',
		rtpCapabilities: {},
	});

	beforeEach(() => {
		webRtcTransport = new WebRtcTransport({
			router,
			connection,
			id: transportId,
			iceParameters,
			iceCandidates,
			dtlsParameters,
			sctpParameters,
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(webRtcTransport.closed).toBe(false);
	});

	it('close()', () => {
		const webRtcTransportMiddleware = webRtcTransport['webRtcTransportMiddleware'];

		webRtcTransport.connection.notify = jest.fn(({ method, data }) => {
			return ({
				'closeWebRtcTransport': () => {
					expect(data.routerId).toBe(webRtcTransport.router.id);
					expect(data.transportId).toBe(transportId);
				},
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		webRtcTransport.close();
		expect(webRtcTransport.connection.notify).toBeCalledTimes(1);
		expect(webRtcTransport.closed).toBe(true);
		expect(webRtcTransport.connection.pipeline.remove).
			toHaveBeenCalledWith(webRtcTransportMiddleware);
	});

	it('connect()', async () => {
		webRtcTransport.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'connectWebRtcTransport': () => {
					expect(data.routerId).toBe(webRtcTransport.router.id);
					expect(data.transportId).toBe(transportId);
					expect(data.dtlsParameters).toBe(dtlsParameters);
				}
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		await webRtcTransport.connect({ dtlsParameters });
		expect(webRtcTransport.connection.request).toBeCalledTimes(1);
	});

	it('produce()', async () => {
		const producerId = 'testProducerId';
		const rtpParameters = {} as RtpParameters;

		webRtcTransport.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'produce': () => {
					expect(data.routerId).toBe(webRtcTransport.router.id);
					expect(data.transportId).toBe(transportId);
					expect(data.kind).toBe(MediaKind.AUDIO);
					expect(data.paused).toBe(false);
					expect(data.rtpParameters).toBe(rtpParameters);

					return { id: producerId };
				}
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		const producer = await webRtcTransport.produce({
			kind: MediaKind.AUDIO,
			paused: false,
			rtpParameters,
		});

		expect(producer.id).toBe(producerId);
		expect(producer.router).toBe(router);
		expect(webRtcTransport.producers.has(producerId)).toBe(true);

		producer.close(true);
		expect(webRtcTransport.producers.has(producerId)).toBe(false);
	});

	it('consume()', async () => {
		const producerId = 'testProducerId';
		const consumerId = 'testConsumerId';
		const rtpParameters = {} as RtpParameters;

		webRtcTransport.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'consume': () => {
					expect(data.routerId).toBe(webRtcTransport.router.id);
					expect(data.transportId).toBe(transportId);
					expect(data.producerId).toBe(producerId);
					expect(data.rtpCapabilities).toBe(rtpCapabilities);

					return {
						id: consumerId,
						kind: MediaKind.AUDIO,
						producerPaused: false,
						rtpParameters,
					};
				}
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		const pipeConsumer = await webRtcTransport.consume({
			producerId,
			rtpCapabilities,
		});

		expect(pipeConsumer.id).toBe(consumerId);
		expect(pipeConsumer.router).toBe(router);
		expect(webRtcTransport.consumers.has(consumerId)).toBe(true);

		pipeConsumer.close(true);
		expect(webRtcTransport.consumers.has(consumerId)).toBe(false);
	});
});