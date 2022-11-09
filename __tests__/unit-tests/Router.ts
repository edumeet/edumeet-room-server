import 'jest';
import { Router } from '../../src/media/Router';
import { MediaNodeConnection } from '../../src/media/MediaNodeConnection';
import MediaNode from '../../src/media/MediaNode';
import { RtpCapabilities, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { SctpCapabilities } from 'mediasoup-client/lib/SctpParameters';
import { SrtpParameters } from '../../src/common/types';
import { Producer } from '../../src/media/Producer';

describe('Router', () => {
	let router1: Router;
	let router2: Router;
	let router3: Router;

	const connection1 = {
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

	const connection2 = {
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

	const connection3 = {
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

	const mediaNode1 = new MediaNode({
		id: 'testId1',
		hostname: 'testHostname',
		port: 1234,
		secret: 'testSecret',
	});

	const mediaNode2 = new MediaNode({
		id: 'testId2',
		hostname: 'testHostname',
		port: 1234,
		secret: 'testSecret',
	});

	beforeEach(() => {
		router1 = new Router({
			mediaNode: mediaNode1,
			connection: connection1,
			id: 'testId1',
			rtpCapabilities: {},
		});

		router2 = new Router({
			mediaNode: mediaNode1,
			connection: connection2,
			id: 'testId2',
			rtpCapabilities: {},
		});

		router3 = new Router({
			mediaNode: mediaNode2,
			connection: connection3,
			id: 'testId3',
			rtpCapabilities: {},
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(router1.closed).toBe(false);
	});

	it('close()', () => {
		const routerMiddleware = router1['routerMiddleware'];

		router1.close();
		expect(router1.closed).toBe(true);
		expect(router1.connection.pipeline.remove).toHaveBeenCalledWith(routerMiddleware);
	});

	it('canConsume()', async () => {
		const producerId = 'testProducerId';
		const rtpCapabilities = {
			codecs: [{
				kind: 'audio',
				mimeType: 'audio/opus',
				clockRate: 48000,
				channels: 2,
			}],
		} as RtpCapabilities;

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'canConsume': ()=> {
					expect(data.routerId).toBe(router1.id);
					expect(data.producerId).toBe(producerId);
					expect(data.rtpCapabilities).toBe(rtpCapabilities);

					return { canConsume: true };
				},
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		const canConsume = await router1.canConsume({
			producerId,
			rtpCapabilities,
		});

		expect(canConsume).toBe(true);
	});

	it('createWebRtcTransport()', async () => {
		const transportId = 'testTransportId';
		const sctpCapabilities = {} as SctpCapabilities;

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createWebRtcTransport': ()=> {
					expect(data.routerId).toBe(router1.id);
					expect(data.forceTcp).toBe(false);
					expect(data.sctpCapabilities).toBe(sctpCapabilities);

					return {
						id: transportId,
						iceParameters: {},
						iceCandidates: [],
						dtlsParameters: {},
						sctpParameters: {},
					};
				},
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		const transport = await router1.createWebRtcTransport({
			forceTcp: false,
			sctpCapabilities,
		});

		expect(transport.id).toBe(transportId);
		expect(router1.webRtcTransports.has(transportId)).toBe(true);
	});

	it('createPipeTransport()', async () => {
		const transportId = 'testTransportId';

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createPipeTransport': ()=> {
					expect(data.routerId).toBe(router1.id);
					expect(data.internal).toBe(false);

					return {
						id: 'testTransportId',
						ip: {},
						port: 1,
						srtpParameters: {},
					};
				},
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		const transport = await router1.createPipeTransport({
			internal: false,
		});

		expect(transport.id).toBe(transportId);
		expect(router1.pipeTransports.has(transportId)).toBe(true);
	});

	it('pipeToRouter() - internal', async () => {
		const producerId = 'testProducerId';
		const pipeConsumerId = 'testPipeConsumerId';
		const transportId = 'testTransportId';
		const ip = 'testIp';
		const port = 1234;
		const rtpParameters = {} as RtpParameters;
		const srtpParameters = {} as SrtpParameters;

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createPipeTransport': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.internal).toBe(true);

					return {
						id: transportId,
						ip,
						port,
						srtpParameters,
					};
				},
				'connectPipeTransport': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.ip).toBe(ip);
					expect(data.port).toBe(port);
					expect(data.srtpParameters).toBe(srtpParameters);
				},
				'createPipeConsumer': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.producerId).toBe(producerId);

					return {
						id: pipeConsumerId,
						kind: 'audio',
						producerPaused: false,
						rtpParameters,
					};
				}
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		router2.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createPipeTransport': () => {
					expect(data.routerId).toBe(router2.id);
					expect(data.internal).toBe(true);

					return {
						id: transportId,
						ip,
						port,
						srtpParameters,
					};
				},
				'connectPipeTransport': () => {
					expect(data.routerId).toBe(router2.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.ip).toBe(ip);
					expect(data.port).toBe(port);
					expect(data.srtpParameters).toBe(srtpParameters);
				},
				'createPipeProducer': () => {
					expect(data.routerId).toBe(router2.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.producerId).toBe(producerId);
					expect(data.kind).toBe('audio');
					expect(data.paused).toBe(false);
					expect(data.rtpParameters).toBe(rtpParameters);

					return { id: producerId };
				}
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		const producer = new Producer({
			router: router1,
			connection: router1.connection,
			id: producerId,
			kind: 'audio',
			rtpParameters,
			paused: false,
		});

		try {
			const { pipeProducer, pipeConsumer } = await router1.pipeToRouter({
				producerId,
				router: router2,
			});
		} catch (error) {
			expect((error as Error).message).toBe('producer not found');
		}

		router1.producers.set(producerId, producer);

		const { pipeProducer, pipeConsumer } = await router1.pipeToRouter({
			producerId,
			router: router2,
		});

		expect(router1.routerPipePromises.has(router2.id)).toBe(true);
		expect(router2.routerPipePromises.has(router1.id)).toBe(true);
		expect(pipeProducer.id).toBe(producerId);
		expect(pipeConsumer.id).toBe(pipeConsumerId);
		expect(pipeConsumer.router).toBe(router1);
		expect(pipeProducer.router).toBe(router2);
		expect(router1.pipeProducers.has(producerId)).toBe(false);
		expect(router2.pipeProducers.has(producerId)).toBe(true);
		expect(router1.pipeTransports.has(transportId)).toBe(true);
		expect(router2.pipeTransports.has(transportId)).toBe(true);
	});

	it('pipeToRouter() - internal', async () => {
		const producerId = 'testProducerId';
		const pipeConsumerId = 'testPipeConsumerId';
		const transportId = 'testTransportId';
		const ip = 'testIp';
		const port = 1234;
		const rtpParameters = {} as RtpParameters;
		const srtpParameters = {} as SrtpParameters;

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createPipeTransport': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.internal).toBe(false);

					return {
						id: transportId,
						ip,
						port,
						srtpParameters,
					};
				},
				'connectPipeTransport': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.ip).toBe(ip);
					expect(data.port).toBe(port);
					expect(data.srtpParameters).toBe(srtpParameters);
				},
				'createPipeConsumer': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.producerId).toBe(producerId);

					return {
						id: pipeConsumerId,
						kind: 'audio',
						producerPaused: false,
						rtpParameters,
					};
				}
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		router3.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createPipeTransport': () => {
					expect(data.routerId).toBe(router3.id);
					expect(data.internal).toBe(false);

					return {
						id: transportId,
						ip,
						port,
						srtpParameters,
					};
				},
				'connectPipeTransport': () => {
					expect(data.routerId).toBe(router3.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.ip).toBe(ip);
					expect(data.port).toBe(port);
					expect(data.srtpParameters).toBe(srtpParameters);
				},
				'createPipeProducer': () => {
					expect(data.routerId).toBe(router3.id);
					expect(data.pipeTransportId).toBe(transportId);
					expect(data.producerId).toBe(producerId);
					expect(data.kind).toBe('audio');
					expect(data.paused).toBe(false);
					expect(data.rtpParameters).toBe(rtpParameters);

					return { id: producerId };
				}
			} [method] ?? (() => expect(true).toBe(false)))();
		});

		const producer = new Producer({
			router: router1,
			connection: router1.connection,
			id: producerId,
			kind: 'audio',
			rtpParameters,
			paused: false,
		});

		try {
			const { pipeProducer, pipeConsumer } = await router1.pipeToRouter({
				producerId,
				router: router3,
			});
		} catch (error) {
			expect((error as Error).message).toBe('producer not found');
		}

		router1.producers.set(producerId, producer);

		const { pipeProducer, pipeConsumer } = await router1.pipeToRouter({
			producerId,
			router: router3,
		});

		expect(router1.routerPipePromises.has(router3.id)).toBe(true);
		expect(router3.routerPipePromises.has(router1.id)).toBe(true);
		expect(pipeProducer.id).toBe(producerId);
		expect(pipeConsumer.id).toBe(pipeConsumerId);
		expect(pipeConsumer.router).toBe(router1);
		expect(pipeProducer.router).toBe(router3);
		expect(router1.pipeProducers.has(producerId)).toBe(false);
		expect(router3.pipeProducers.has(producerId)).toBe(true);
		expect(router1.pipeTransports.has(transportId)).toBe(true);
		expect(router3.pipeTransports.has(transportId)).toBe(true);
	});
});