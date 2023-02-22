import 'jest';
import { Router } from '../../../src/media/Router';
import { MediaNodeConnection } from '../../../src/media/MediaNodeConnection';
import MediaNode from '../../../src/media/MediaNode';
import { RtpCapabilities, RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { SctpCapabilities } from 'mediasoup-client/lib/SctpParameters';
import { Producer } from '../../../src/media/Producer';
import { WebRtcTransport } from '../../../src/media/WebRtcTransport';
import { PipeTransport } from '../../../src/media/PipeTransport';
import { EventEmitter } from 'events';
import { DataProducer } from '../../../src/media/DataProducer';
import { PipeDataProducer } from '../../../src/media/PipeDataProducer';
import { PipeConsumer } from '../../../src/media/PipeConsumer';
import { MediaKind } from 'edumeet-common';
import GeoPosition from '../../../src/loadbalancing/GeoPosition';

const geoPosition = {} as unknown as GeoPosition;

class MockMediaNodeConnection extends EventEmitter {
	pipeline = { use: jest.fn(), remove: jest.fn() };
	notify = jest.fn();
}

class MockWebRtcTransport extends EventEmitter {
	id = 'id';
	sctpCapabilities = {} as SctpCapabilities;
}

class MockPipeTransport extends EventEmitter {
	consume = jest.fn(() => { return new MockPipeConsumer(); });
	produce = jest.fn(() => { return new MockPipeProducer(); });
	consumeData = jest.fn().mockImplementation(() => { return new MockDataConsumer(); });
	produceData = jest.fn().mockImplementation(() => { return new MockDataProducer(); });
	ip = 'testIp';
	port = 1234;
	srtpParameters = {};
}

class MockPipeTransportPaused extends EventEmitter {
	consume = jest.fn(() => { return new MockPipeConsumer(); });
	produce = jest.fn(() => { return new MockPipeProducerPaused(); });
}

class MockDataProducer extends EventEmitter {
	close = jest.fn();
}

class MockDataConsumer extends EventEmitter {
	sctpStreamParameters = jest.fn();
	close = jest.fn();
}

class MockPipeConsumer extends EventEmitter {
	kind = MediaKind.VIDEO;
	close = jest.fn();
}

class MockPipeProducer extends EventEmitter {
	close = jest.fn();
	kind = MediaKind.VIDEO;
	pause = jest.fn();
}

class MockPipeProducerPaused extends EventEmitter {
	close = jest.fn();
	kind = MediaKind.VIDEO;
	paused = false;
	public async resume(): Promise<void> { this.paused = false; }
	public async pause(): Promise<void> { this.paused = true; }
}

type PipeTransportPair = {
	[key: string]: PipeTransport;
};

describe('Router', () => {
	let router1: Router;
	let router2: Router;
	let router3: Router;

	const mediaNode1 = new MediaNode({
		id: 'testId1',
		hostname: 'testHostname',
		port: 1234,
		secret: 'testSecret',
		geoPosition
	});

	const mediaNode2 = new MediaNode({
		id: 'testId2',
		hostname: 'testHostname',
		port: 1234,
		secret: 'testSecret',
		geoPosition
	});

	let mockConnection1: MediaNodeConnection;
	let mockConnection2: MediaNodeConnection;
	let mockConnection3: MediaNodeConnection;

	beforeEach(() => {
		mockConnection1 = new MockMediaNodeConnection() as unknown as MediaNodeConnection;
		mockConnection2 = new MockMediaNodeConnection() as unknown as MediaNodeConnection;
		mockConnection3 = new MockMediaNodeConnection() as unknown as MediaNodeConnection;
		router1 = new Router({
			mediaNode: mediaNode1,
			connection: mockConnection1,
			id: 'testId1',
			rtpCapabilities: {},
		});

		router2 = new Router({
			mediaNode: mediaNode1,
			connection: mockConnection2,
			id: 'testId2',
			rtpCapabilities: {},
		});

		router3 = new Router({
			mediaNode: mediaNode2,
			connection: mockConnection3,
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

	it('close() - Should close transports', () => {
		const fakeWebRtcTransport = { close: jest.fn() } as unknown as WebRtcTransport;
		const fakePipeTransport = { close: jest.fn() } as unknown as PipeTransport;
		const spyWebRtcTransport = jest.spyOn(fakeWebRtcTransport, 'close');
		const spyPipeTransport = jest.spyOn(fakePipeTransport, 'close');

		router1.webRtcTransports.set('t', fakeWebRtcTransport);
		router1.pipeTransports.set('p', fakePipeTransport);
		router1.close();

		expect(spyPipeTransport).toHaveBeenCalled();
		expect(spyWebRtcTransport).toHaveBeenCalled();
	});

	it('close event from connection - Should close router', () => {
		expect(router3.closed).toBe(false);
		
		mockConnection3.emit('close');
		
		expect(router3.closed).toBe(true);
	});

	it('canConsume()', async () => {
		const producerId = 'testProducerId';
		const rtpCapabilities = {
			codecs: [ {
				kind: MediaKind.AUDIO,
				mimeType: 'audio/opus',
				clockRate: 48000,
				channels: 2,
			} ],
		} as RtpCapabilities;

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'canConsume': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.producerId).toBe(producerId);
					expect(data.rtpCapabilities).toBe(rtpCapabilities);

					return { canConsume: true };
				},
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		const canConsume = await router1.canConsume({
			producerId,
			rtpCapabilities,
		});

		expect(canConsume).toBe(true);
	});

	it('createWebRtcTransport()', async () => {
		const spyDelete = jest.spyOn(router1.webRtcTransports, 'delete');
		const mockWebRtcTransport = new MockWebRtcTransport();

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createWebRtcTransport': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.forceTcp).toBe(false);
					expect(data.sctpCapabilities).toBe(mockWebRtcTransport.sctpCapabilities);

					return mockWebRtcTransport; 
				},
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		const transport = await router1.createWebRtcTransport({
			forceTcp: false,
			sctpCapabilities: mockWebRtcTransport.sctpCapabilities
		});

		expect(transport.id).toBe('id');
		expect(router1.webRtcTransports.has('id')).toBe(true);

		const webRtcTransport = router1.webRtcTransports.get('id');

		expect(webRtcTransport).toBeTruthy();
		if (webRtcTransport) {
			webRtcTransport.emit('close');
			expect(spyDelete).toHaveBeenCalled();
		}
	});

	it('createPipeTransport()', async () => {
		const transportId = 'testTransportId';

		router1.connection.request = jest.fn(async ({ method, data }) => {
			return ({
				'createPipeTransport': () => {
					expect(data.routerId).toBe(router1.id);
					expect(data.internal).toBe(false);

					return {
						id: 'testTransportId',
						ip: {},
						port: 1,
						srtpParameters: {},
					};
				},
			}[method] ?? (() => expect(true).toBe(false)))();
		});

		const transport = await router1.createPipeTransport({
			internal: false,
		});

		expect(transport.id).toBe(transportId);
		expect(router1.pipeTransports.has(transportId)).toBe(true);
	});
		
	describe('pipeToRouter()', () => {
		let fakePipeDataProducer: PipeDataProducer;
		let fakeDataProducer: DataProducer;
		let fakePipeConsumer: PipeConsumer;
		let fakePipeTransport1: PipeTransport;
		let fakePipeTransport3: PipeTransport;
		let fakePipeTransport2: PipeTransport;
		let fakeProducer1: Producer;
		let fakeProducer2: Producer;
		let spyPipePromisesDelete: jest.SpyInstance;

		beforeEach(() => {
			fakePipeTransport1 = new MockPipeTransport() as unknown as PipeTransport;
			fakePipeTransport1.id = 'id1';
			fakePipeTransport2 = new MockPipeTransport() as unknown as PipeTransport;
			fakePipeTransport2.id = 'id2';
			fakePipeTransport3 = new MockPipeTransportPaused() as unknown as PipeTransport;
			fakeProducer1 = { 
				id: 'id', 
				paused: false,
				router: router1,
				connection: mockConnection3,
				kind: MediaKind.AUDIO,
				rtpParameters: {} as RtpParameters,
			} as unknown as Producer;
			fakeProducer2 = { id: 'id' } as unknown as Producer;
			fakePipeConsumer = {
				id: 'id',
				kind: MediaKind.AUDIO,
				producerPaused: false,
				rtpParameters: {} as RtpParameters,
			} as unknown as PipeConsumer;
			fakePipeDataProducer = { id: 'id' } as unknown as PipeDataProducer;
			fakeDataProducer = { id: 'id' } as unknown as DataProducer;
			spyPipePromisesDelete = jest.spyOn(router1.routerPipePromises, 'delete');
			router1.producers.set(fakeProducer1.id, fakeProducer1);
		});

		it('pipeToRouter() - internal', async () => {
			router1.connection.request = jest.fn(async ({ method, data }) => {
				return ({
					'createPipeTransport': () => {
						expect(data.routerId).toBe(router1.id);
						expect(data.internal).toBe(true);

						return fakePipeTransport1; 
					},
					'connectPipeTransport': () => {
						expect(data.routerId).toBe(router1.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport1.id);
						expect(data.ip).toBe(fakePipeTransport1.ip);
						expect(data.port).toBe(fakePipeTransport1.port);
						expect(data.srtpParameters).toEqual(fakePipeTransport1.srtpParameters);
					},
					'createPipeConsumer': () => {
						expect(data.routerId).toBe(router1.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport1.id);
						expect(data.producerId).toBe(fakeProducer1.id);

						return fakePipeConsumer; 
					}
				}[method] ?? (() => expect(true).toBe(false)))();
			});

			router2.connection.request = jest.fn(async ({ method, data }) => {
				return ({
					'createPipeTransport': () => {
						expect(data.routerId).toBe(router2.id);
						expect(data.internal).toBe(true);
						
						return fakePipeTransport2; 

					},
					'connectPipeTransport': () => {
						expect(data.routerId).toBe(router2.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport2.id);
						expect(data.ip).toBe(fakePipeTransport2.ip);
						expect(data.port).toBe(fakePipeTransport2.port);
						expect(data.srtpParameters).toEqual(fakePipeTransport2.srtpParameters);
					},
					'createPipeProducer': () => {
						expect(data.routerId).toBe(router2.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport2.id);
						expect(data.producerId).toBe(fakeProducer1.id);
						expect(data.kind).toBe(MediaKind.AUDIO);
						expect(data.paused).toBe(false);
						expect(data.rtpParameters).toEqual(fakeProducer1.rtpParameters);

						return { id: fakeProducer1.id };
					}
				}[method] ?? (() => expect(true).toBe(false)))();
			});

			try {
				await router1.pipeToRouter({
					producerId: 'non existing',
					router: router2,
				});
			} catch (error) {
				expect((error as Error).message).toBe('Producer not found');
			}

			const { pipeProducer, pipeConsumer } = await router1.pipeToRouter({
				producerId: fakeProducer1.id,
				router: router2,
			});

			expect(router1.routerPipePromises.has(router2.id)).toBe(true);
			expect(router2.routerPipePromises.has(router1.id)).toBe(true);
			expect(pipeProducer?.id).toBe(fakeProducer1.id);
			expect(pipeConsumer?.id).toBe(fakePipeConsumer.id);
			expect(pipeConsumer?.router).toBe(router1);
			expect(pipeProducer?.router).toBe(router2);
			expect(router1.pipeProducers.has(fakeProducer1.id)).toBe(false);
			expect(router2.pipeProducers.has(fakeProducer1.id)).toBe(true);
			expect(router1.pipeTransports.has(fakePipeTransport1.id)).toBe(true);
			expect(router2.pipeTransports.has(fakePipeTransport2.id)).toBe(true);

			const pipeTransport1 = router1.pipeTransports.get(fakePipeTransport1.id);
			const pipeTransport2 = router2.pipeTransports.get(fakePipeTransport2.id);

			expect(pipeTransport1).toBeTruthy();
			expect(pipeTransport2).toBeTruthy();

			if (pipeTransport1 && pipeTransport2) {
				const spyClose1 = jest.spyOn(pipeTransport1, 'close');
				const spyClose2 = jest.spyOn(pipeTransport2, 'close');

				expect(pipeTransport1.id).toBe('id1');
				expect(pipeTransport2.id).toBe('id2');
				expect(spyClose2).not.toHaveBeenCalled();
				expect(spyClose1).not.toHaveBeenCalled();
				expect(spyPipePromisesDelete).not.toHaveBeenCalled();
				pipeTransport1.emit('close');
				expect(spyClose2).toHaveBeenCalled();
				expect(spyClose1).toHaveBeenCalled();
				expect(spyPipePromisesDelete).toHaveBeenCalled();
			}
		});

		it('pipeToRouter() - internal', async () => {
			router1.connection.request = jest.fn(async ({ method, data }) => {
				return ({
					'createPipeTransport': () => {
						expect(data.routerId).toBe(router1.id);
						expect(data.internal).toBe(false);

						return fakePipeTransport2;
					},
					'connectPipeTransport': () => {
						expect(data.routerId).toBe(router1.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport2.id);
						expect(data.ip).toBe(fakePipeTransport2.ip);
						expect(data.port).toBe(fakePipeTransport2.port);
						expect(data.srtpParameters).toBe(fakePipeTransport2.srtpParameters);
					},
					'createPipeConsumer': () => {
						expect(data.routerId).toBe(router1.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport2.id);
						expect(data.producerId).toBe(fakeProducer1.id);

						return fakePipeConsumer; 
					}
				}[method] ?? (() => expect(true).toBe(false)))();
			});

			router3.connection.request = jest.fn(async ({ method, data }) => {
				return ({
					'createPipeTransport': () => {
						expect(data.routerId).toBe(router3.id);
						expect(data.internal).toBe(false);

						return fakePipeTransport2;
					},
					'connectPipeTransport': () => {
						expect(data.routerId).toBe(router3.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport2.id);
						expect(data.ip).toBe(fakePipeTransport2.ip);
						expect(data.port).toBe(fakePipeTransport2.port);
						expect(data.srtpParameters).toBe(fakePipeTransport2.srtpParameters);
					},
					'createPipeProducer': () => {
						expect(data.routerId).toBe(router3.id);
						expect(data.pipeTransportId).toBe(fakePipeTransport2.id);
						expect(data.producerId).toBe(fakeProducer1.id);
						expect(data.kind).toBe(MediaKind.AUDIO);
						expect(data.paused).toBe(false);
						expect(data.rtpParameters).toEqual(fakeProducer1.rtpParameters);

						return { id: fakeProducer1.id };
					}
				}[method] ?? (() => expect(true).toBe(false)))();
			});

			try {
				await router1.pipeToRouter({
					producerId: 'non existing',
					router: router3,
				});
			} catch (error) {
				expect((error as Error).message).toBe('Producer not found');
			}

			const { pipeProducer, pipeConsumer } = await router1.pipeToRouter({
				producerId: fakeProducer1.id,
				router: router3,
			});

			expect(router1.routerPipePromises.has(router3.id)).toBe(true);
			expect(router3.routerPipePromises.has(router1.id)).toBe(true);
			expect(pipeProducer?.id).toBe(fakeProducer1.id);
			expect(pipeConsumer?.id).toBe(fakePipeConsumer.id);
			expect(pipeConsumer?.router).toBe(router1);
			expect(pipeProducer?.router).toBe(router3);
			expect(router1.pipeProducers.has(fakeProducer1.id)).toBe(false);
			expect(router3.pipeProducers.has(fakeProducer1.id)).toBe(true);
			expect(router1.pipeTransports.has(fakePipeTransport2.id)).toBe(true);
			expect(router3.pipeTransports.has(fakePipeTransport2.id)).toBe(true);
		});

		it('pipeToRouter() - Should throw on no producerId', async () => {
			await expect(router1.pipeToRouter(
				{ producerId: undefined, router: router2 }
			)).rejects.toThrow();
		});
	
		it('pipeToRouter() - Should throw on no dataProducerId', async () => {
			await expect(router1.pipeToRouter(
				{ dataProducerId: undefined, router: router2 }
			)).rejects.toThrow();
		});
		
		it('pipeToRouter() - Should throw on dataProducerId and producerId', async () => {
			await expect(router1.pipeToRouter(
				{ dataProducerId: 'id', producerId: 'id', router: router2 }
			)).rejects.toThrow();
		});
	
		it('pipeToRouter() - Should throw on non existing producerId', async () => {
			await expect(router1.pipeToRouter(
				{ producerId: 'does not exist', router: router2 }
			)).rejects.toThrow();
		});
	
		it('pipeToRouter() - Should throw on non existing dataProducerId', async () => {
			await expect(router1.pipeToRouter(
				{ dataProducerId: 'does not exist', router: router2 }
			)).rejects.toThrow();
		});
	
		it('pipeToRouter() - Should find existing dataProducer', async () => {
			router1.dataProducers.set('testId1', fakeDataProducer);
			await expect(router1.pipeToRouter(
				{ dataProducerId: 'testId1', router: router2 }
			)).rejects.toThrow();
		});
	
		it('pipeToRouter() - Should find existing pipeDataProducer', async () => {

			router1.pipeDataProducers.set('id', fakePipeDataProducer);
			await expect(router1.pipeToRouter(
				{ dataProducerId: 'id', router: router2 }
			)).rejects.toThrow();
		});

		it('pipeToRouter() - Should have pipeTransportPair', async () => {
			router1.producers.set(fakeProducer2.id, fakeProducer2);
			jest.spyOn(router1, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport1;
			});
			jest.spyOn(router2, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport1;
			});
			jest.spyOn(router1.routerPipePromises, 'get').mockImplementation(async () => {
				return {
					'testId1': fakePipeTransport1,
					'testId2': fakePipeTransport1
				} as unknown as PipeTransportPair;
			});
			expect(router1.routerPipePromises.size == 0);
		
			const { pipeConsumer, pipeProducer } = await router1.pipeToRouter(
				{ producerId: fakeProducer2.id, router: router2 });

			expect(router1.routerPipePromises.size == 1);
			expect(pipeConsumer).toBeTruthy();
			expect(pipeProducer).toBeTruthy();
		});
		
		it('pipeToRouter() - Producer and pipeProducer pause should sync', async () => {
			fakeProducer2.paused = true;

			router1.producers.set(fakeProducer2.id, fakeProducer2);
			jest.spyOn(router1, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport3;
			});
			jest.spyOn(router2, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport3;
			});
			jest.spyOn(router1.routerPipePromises, 'get').mockImplementation(async () => {
				return {
					'testId1': fakePipeTransport3,
					'testId2': fakePipeTransport3
				} as unknown as PipeTransportPair;
			});
		
			const { pipeProducer } = await router1.pipeToRouter(
				{ producerId: fakeProducer2.id, router: router2 });

			if (pipeProducer) {
				expect(fakeProducer2.paused).toBe(true);
				expect(pipeProducer.paused).toBe(true);
			}
		});

		it('pipeToRouter() - Should throw on closed producer ', async () => {
			fakeProducer2.closed = true;

			router1.producers.set(fakeProducer2.id, fakeProducer2);
			jest.spyOn(router1, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport3;
			});
			jest.spyOn(router2, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport3;
			});
			jest.spyOn(router1.routerPipePromises, 'get').mockImplementation(async () => {
				return {
					'testId1': fakePipeTransport3,
					'testId2': fakePipeTransport3
				} as unknown as PipeTransportPair;
			});
		
			await expect(router1.pipeToRouter(
				{ producerId: fakeProducer2.id, router: router2 })).rejects.toThrow();
		});

		it('pipeToRouter() - Should throw on closed dataProducer ', async () => {
			fakeDataProducer.closed = true;

			router1.dataProducers.set(fakeDataProducer.id, fakeDataProducer);
			jest.spyOn(router1, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport1;
			});
			jest.spyOn(router2, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport1;
			});
			jest.spyOn(router1.routerPipePromises, 'get').mockImplementation(async () => {
				return {
					'testId1': fakePipeTransport1,
					'testId2': fakePipeTransport1
				} as unknown as PipeTransportPair;
			});
			await expect(router1.pipeToRouter(
				{ dataProducerId: fakeDataProducer.id, router: router2 })).rejects.toThrow();
		});
		
		it('pipeToRouter() - Should close pipedata consumer/producer on close event', async () => {
			router1.dataProducers.set(fakeDataProducer.id, fakeDataProducer);
			jest.spyOn(router1, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport1;
			});
			jest.spyOn(router2, 'createPipeTransport').mockImplementation(async () => {
				return fakePipeTransport1;
			});
			jest.spyOn(router1.routerPipePromises, 'get').mockImplementation(async () => {
				return {
					'testId1': fakePipeTransport1,
					'testId2': fakePipeTransport1
				} as unknown as PipeTransportPair;
			});
			
			const { pipeDataConsumer, pipeDataProducer } = await router1.pipeToRouter(
				{ dataProducerId: fakeDataProducer.id, router: router2 });
			
			if (pipeDataConsumer && pipeDataProducer) {
				const spyClose1 = jest.spyOn(pipeDataProducer, 'close');
				const spyClose2 = jest.spyOn(pipeDataConsumer, 'close');

				pipeDataConsumer.emit('close');	
				expect(spyClose1).toHaveBeenCalled();
				pipeDataProducer.emit('close');	
				expect(spyClose2).toHaveBeenCalled();
			}
		});
	});
});