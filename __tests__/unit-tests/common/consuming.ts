import 'jest';
import { RtpCapabilities } from 'mediasoup-client/lib/RtpParameters';
import { EventEmitter } from 'events';
import { createConsumer, createDataConsumer } from '../../../src/common/consuming';
import { Consumer } from '../../../src/media/Consumer';
import { DataConsumer } from '../../../src/media/DataConsumer';
import { DataProducer } from '../../../src/media/DataProducer';
import { Producer } from '../../../src/media/Producer';
import { Router } from '../../../src/media/Router';
import { WebRtcTransport } from '../../../src/media/WebRtcTransport';
import { Peer } from '../../../src/Peer';

describe('consuming', () => {
	let fakeConsumerPeer: Peer;
	let fakeProducerPeer: Peer;
	let fakeProducerRouter: Router;
	let fakeConsumerRouter: Router;
	let fakeRouterAppdata: Record<string, unknown>;
	let fakePipePromises: Map<string, Promise<void>>;
	let fakeRtpCapabilities: RtpCapabilities;
	let fakeTransportAppdata: Record<string, unknown>;
	const FAKE_PRODUCER_ID = 'producerId1';

	beforeEach(() => {
		fakeProducerRouter = { id: 'routerId1', canConsume: jest.fn() } as unknown as Router;
		fakeConsumerRouter = { id: 'routerId2', appData: fakeRouterAppdata } as unknown as Router;
		fakeConsumerPeer = { 
			id: 'peerId1', 
			consumers: new Map<string, Consumer>(),
			dataConsumers: new Map<string, DataConsumer>(),
			rtpCapabilities: null,
			transports: new Map<string, WebRtcTransport>(),
			close: jest.fn(),
			closed: false,
			notify: jest.fn()
		} as unknown as Peer;
		fakeProducerPeer = { id: 'peerId2' } as unknown as Peer;
		fakeRouterAppdata = { pipePromises: fakePipePromises };
		fakePipePromises = new Map<string, Promise<void>>();
		fakePipePromises.set(FAKE_PRODUCER_ID, Promise.resolve());
		fakeRtpCapabilities = {} as unknown as RtpCapabilities;
		fakeTransportAppdata = { 'consuming': {} };
	});
	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('createConsumer()', () => {
		let fakeProducer: Producer;
		let spyConsumersSet: jest.SpyInstance;
		let fakeConsumer: Consumer;
		let fakeConsumingTransport: WebRtcTransport;

		beforeEach(() => {
			fakeProducer = { id: FAKE_PRODUCER_ID } as unknown as Producer;
			spyConsumersSet = jest.spyOn(fakeConsumerPeer.consumers, 'set');
			fakeConsumer = { close: jest.fn() } as unknown as Consumer;
			fakeConsumingTransport = {
				appData: fakeTransportAppdata,
				consume: jest.fn().mockImplementation(() => {
					return fakeConsumer;
				})
			} as unknown as WebRtcTransport;
		});

		describe('Preconditions not met', () => {
			it('Should not add consumer when preconditions are not met', async () => {
				const spyCanConsume = jest.spyOn(fakeProducerRouter, 'canConsume').mockResolvedValue(true);

				createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(spyCanConsume).not.toHaveBeenCalled();
				fakeProducerPeer.router = fakeProducerRouter;
				createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(spyCanConsume).not.toHaveBeenCalled();
				fakeConsumerPeer.router = fakeConsumerRouter;
				createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(spyCanConsume).not.toHaveBeenCalled();
				fakeConsumerPeer.rtpCapabilities = fakeRtpCapabilities;
				await createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(fakeConsumerPeer.consumers.size).toBe(0);
				expect(spyCanConsume).toHaveBeenCalledTimes(1);

				expect(fakeConsumerPeer.consumers.size).toBe(0);
			});
			
			it('Should not add consumer when producerRouter can\'t consume', async () => {
				const spyCanConsume = jest.spyOn(fakeProducerRouter, 'canConsume').mockResolvedValue(false);

				fakeProducerPeer.router = fakeProducerRouter;
				fakeConsumerPeer.router = fakeConsumerRouter;
				fakeConsumerPeer.rtpCapabilities = fakeRtpCapabilities;
				await createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(fakeConsumerPeer.consumers.size).toBe(0);
				expect(spyCanConsume).toHaveBeenCalledTimes(1);
			});
		});
		
		describe('Preconditions met', () => {
			let spyCanConsume: jest.SpyInstance;

			beforeEach(() => {
				fakeProducerPeer.router = fakeProducerRouter;
				fakeConsumerPeer.rtpCapabilities = fakeRtpCapabilities;
				fakeConsumerPeer.router = fakeConsumerRouter;
				fakeConsumerPeer.transports.set('fake', fakeConsumingTransport);
				spyCanConsume = jest.spyOn(fakeProducerRouter, 'canConsume').mockImplementation(async () => {
					return true;
				});
			});
		
			it('Should set consumer when transport exists', async () => {
				const spyTransportConsume = jest.spyOn(fakeConsumingTransport, 'consume');

				await createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(spyCanConsume).toHaveBeenCalledTimes(1);
				expect(spyConsumersSet).toHaveBeenCalled();
				expect(spyTransportConsume).toHaveBeenCalled();
				expect(fakeConsumerPeer.consumers.size).toBe(1);
			});

			it('Should close consumer on consumerPeer close()', async () => {
				fakeConsumerPeer.closed = true;
				const spyConsumerClose = jest.spyOn(fakeConsumer, 'close');

				await createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				expect(spyConsumerClose).toHaveBeenCalled();
			});
		
			describe('Consumer events', () => {
				let spyNotify: jest.SpyInstance;

				beforeEach(async () => {
					fakeConsumer = new EventEmitter as Consumer;
					spyNotify = jest.spyOn(fakeConsumerPeer, 'notify');
					await createConsumer(fakeConsumerPeer, fakeProducerPeer, fakeProducer);
				});

				it('emit close: should delete consumer and notify', () => {
					const spyDelete = jest.spyOn(fakeConsumerPeer.consumers, 'delete');

					fakeConsumer.emit('close');
					expect(spyDelete).toHaveBeenCalled();
					expect(spyNotify).toHaveBeenCalledTimes(2);
					expect(spyNotify.mock.calls[1][0].method).toBe('consumerClosed');
				});
				
				it('emit producerpause: should notify', () => {
					fakeConsumer.emit('producerpause');
					expect(spyNotify).toHaveBeenCalledTimes(2);
					expect(spyNotify.mock.calls[1][0].method).toBe('consumerPaused');
				});
				
				it('emit producerresume: should notify', () => {
					fakeConsumer.emit('producerresume');
					expect(spyNotify).toHaveBeenCalledTimes(2);
					expect(spyNotify.mock.calls[1][0].method).toBe('consumerResumed');
				});
				
				it('emit score: should notify', () => {
					fakeConsumer.emit('score');
					expect(spyNotify).toHaveBeenCalledTimes(2);
					expect(spyNotify.mock.calls[1][0].method).toBe('consumerScore');
				});
				
				it('emit layerschange: should notify', () => {
					fakeConsumer.emit('layerschange');
					expect(spyNotify).toHaveBeenCalledTimes(2);
					expect(spyNotify.mock.calls[1][0].method).toBe('consumerLayersChanged');
				});
			});
		});

	});
	describe('createDataConsumer()', () => {
		let fakeDataProducer: DataProducer;
		let fakeDataConsumingTransport: WebRtcTransport; 
		let fakeDataConsumer: DataConsumer;
		let spyDataConsumersSet: jest.SpyInstance;

		beforeEach(() => {
			spyDataConsumersSet = jest.spyOn(fakeConsumerPeer.dataConsumers, 'set');
			fakeDataProducer = { id: FAKE_PRODUCER_ID } as unknown as DataProducer;
			fakeDataConsumer = { close: jest.fn() } as unknown as DataConsumer;
			fakeDataConsumingTransport = {
				appData: fakeTransportAppdata,
				consumeData: jest.fn().mockImplementation(() => {
					return fakeDataConsumer;
				})
			} as unknown as WebRtcTransport;
		});

		describe('Preconditions not met', () => {
			it('Should not add dataConsumer when preconditions are not met', async () => {
				await createDataConsumer(fakeConsumerPeer, fakeProducerPeer, fakeDataProducer);
				fakeProducerPeer.router = fakeProducerRouter;
				await createDataConsumer(fakeConsumerPeer, fakeProducerPeer, fakeDataProducer);
				fakeConsumerPeer.router = fakeConsumerRouter;
				await createDataConsumer(fakeConsumerPeer, fakeProducerPeer, fakeDataProducer);
				expect(fakeConsumerPeer.dataConsumers.size).toBe(0);
			});
		});
		describe('Preconditions met', () => {
			beforeEach(() => {
				fakeProducerPeer.router = fakeProducerRouter;
				fakeConsumerPeer.router = fakeConsumerRouter;
				fakeConsumerPeer.rtpCapabilities = fakeRtpCapabilities;
				fakeConsumerPeer.transports.set('fake', fakeDataConsumingTransport);
			});

			it('Should set dataConsumer when transport exists', async () => {
				await createDataConsumer(fakeConsumerPeer, fakeProducerPeer, fakeDataProducer);
				expect(spyDataConsumersSet).toHaveBeenCalled();
				expect(fakeConsumerPeer.dataConsumers.size).toBe(1);
			});

			it('Should close dataConsumer on consumerPeer close()', async () => {
				fakeConsumerPeer.closed = true;
				const spyConsumerClose = jest.spyOn(fakeDataConsumer, 'close');

				await createDataConsumer(fakeConsumerPeer, fakeProducerPeer, fakeDataProducer);
				expect(spyConsumerClose).toHaveBeenCalled();
			});

			describe('DataConsumer events', () => {
				let spyNotify: jest.SpyInstance;

				beforeEach(async () => {
					fakeDataConsumer = new EventEmitter as DataConsumer;
					spyNotify = jest.spyOn(fakeConsumerPeer, 'notify');
					await createDataConsumer(fakeConsumerPeer, fakeProducerPeer, fakeDataProducer);
				});

				it('emit close: should delete consumer and notify', () => {
					const spyDelete = jest.spyOn(fakeConsumerPeer.dataConsumers, 'delete');

					fakeDataConsumer.emit('close');
					expect(spyDelete).toHaveBeenCalled();
					expect(spyNotify).toHaveBeenCalledTimes(2);
					expect(spyNotify.mock.calls[1][0].method).toBe('dataConsumerClosed');
				});
			});
		});
	});
});