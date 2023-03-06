import { Next } from 'edumeet-common';
import { MiddlewareOptions } from '../../../src/common/types';
import { createMediaMiddleware } from '../../../src/middlewares/mediaMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import * as authorization from '../../../src/common/authorization';
import { WebRtcTransport } from '../../../src/media/WebRtcTransport';
import { Producer } from '../../../src/media/Producer';
jest.spyOn(authorization, 'permittedProducer').mockImplementation(() => { return; });
import ProducerMock from '../../../__mocks__/ProducerMock';
import ConsumerMock from '../../../__mocks__/ConsumerMock';
import * as consuming from '../../../src/common/consuming';
import { Consumer } from '../../../src/media/Consumer';
import { DataProducer } from '../../../src/media/DataProducer';

const next = jest.fn() as Next;
const SESSION_ID = 'sessionId';

afterEach(() => {
	jest.clearAllMocks();
});

test('Should not handle wrong session', async () => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const context = {
		message: {
			data: {
				sessionId: 'wrong session'
			}
		}
	} as PeerContext;

	await sut(context, next);
    
	expect(context.handled).toBeFalsy();
});

test('Should not unrelated messages', async () => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test.each([
	[ 'produce' ],
	[ 'produceData' ]
])('produce() - Should throw on missing transport', async (methodToTest: string) => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const appData = {};
	const peer = {
		transports: new Map<string, WebRtcTransport>()
	} as Peer;
    
	const context = {
		peer,
		message: {
			method: methodToTest,
			data: {
				appData,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();

});

test('produce() - Should create producer', async () => {
	const spyCreateConsumer = jest.spyOn(consuming, 'createConsumer').mockImplementation(async () => {
		return;
	});
	const fakePeer = {};
	const getPeers = jest.fn().mockImplementation(() => {
		return [ fakePeer ];
	});
	const room = {
		getPeers,
		sessionId: SESSION_ID
	};
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const appData = {};
	const peer = {
		transports: new Map<string, WebRtcTransport>(),
		producers: new Map<string, Producer>()
	} as Peer;
	const spySetProducer = jest.spyOn(peer.producers, 'set');
	const producerMock = new ProducerMock();
	const spyTransportProduce = jest.fn().mockImplementation(() => {
		return producerMock;
	});
	const transport = {
		id: 'id',
		produce: spyTransportProduce
	} as unknown as WebRtcTransport;

	peer.transports.set(transport.id, transport);
    
	const context = {
		peer,
		response: {},
		message: {
			method: 'produce',
			data: {
				transportId: 'id',
				appData,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(getPeers).toHaveBeenCalled();
	expect(spyTransportProduce).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
	expect(spySetProducer).toHaveBeenCalled();
	expect(spyCreateConsumer).toHaveBeenCalled();
	expect(context.response.id).toBe(producerMock.id);
});

test('produce() - Should handle events', async () => {
	jest.spyOn(consuming, 'createDataConsumer').mockImplementation(async () => {
		return;
	});
	const getPeers = jest.fn().mockImplementation(() => {
		return [];
	});
	const room = {
		getPeers,
		sessionId: SESSION_ID
	};
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const appData = {};
	const notify = jest.fn();
	const peer = {
		notify,
		transports: new Map<string, WebRtcTransport>(),
		producers: new Map<string, Producer>()
	} as unknown as Peer;
	const spyProducerDelete = jest.spyOn(peer.producers, 'delete');
	const producerMock = new ProducerMock();
	const spyTransportProduce = jest.fn().mockImplementation(() => {
		return producerMock;
	});
	const transport = {
		id: 'id',
		produce: spyTransportProduce
	} as unknown as WebRtcTransport;

	peer.transports.set(transport.id, transport);
    
	const context = {
		peer,
		response: {},
		message: {
			method: 'produce',
			data: {
				transportId: 'id',
				appData,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	producerMock.emit('score');
	expect(notify.mock.calls[0][0].method).toBe('producerScore');

	producerMock.emit('close');
	expect(notify.mock.calls[1][0].method).toBe('producerClosed');
	expect(spyProducerDelete).toHaveBeenCalled();
});

test('produceData() - Should create DataProducer', async () => {
	const spyCreateDataConsumer = jest.spyOn(consuming, 'createDataConsumer').mockImplementation(async () => {
		return;
	});
	const fakePeer = {};
	const getPeers = jest.fn().mockImplementation(() => {
		return [ fakePeer ];
	});
	const room = {
		getPeers,
		sessionId: SESSION_ID
	};
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const appData = {};
	const peer = {
		transports: new Map<string, WebRtcTransport>(),
		dataProducers: new Map<string, DataProducer>()
	} as Peer;
	const spySetDataProducer = jest.spyOn(peer.dataProducers, 'set');
	const producerMock = new ProducerMock();
	const spyTransportProduceData = jest.fn().mockImplementation(() => {
		return producerMock;
	});
	const transport = {
		id: 'id',
		produceData: spyTransportProduceData
	} as unknown as WebRtcTransport;

	peer.transports.set(transport.id, transport);
    
	const context = {
		peer,
		response: {},
		message: {
			method: 'produceData',
			data: {
				transportId: 'id',
				appData,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(getPeers).toHaveBeenCalled();
	expect(spyTransportProduceData).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
	expect(spySetDataProducer).toHaveBeenCalled();
	expect(spyCreateDataConsumer).toHaveBeenCalled();
	expect(context.response.id).toBe(producerMock.id);
});

test('produceData() - Should handle events ', async () => {
	jest.spyOn(consuming, 'createDataConsumer').mockImplementation(async () => {
		return;
	});
	const fakePeer = {};
	const getPeers = jest.fn().mockImplementation(() => {
		return [ fakePeer ];
	});
	const room = {
		getPeers,
		sessionId: SESSION_ID
	};
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const appData = {};
	const notify = jest.fn();
	const peer = {
		notify,
		transports: new Map<string, WebRtcTransport>(),
		dataProducers: new Map<string, DataProducer>()
	} as unknown as Peer;
	const producerMock = new ProducerMock();
	const spyTransportProduceData = jest.fn().mockImplementation(() => {
		return producerMock;
	});
	const transport = {
		id: 'id',
		produceData: spyTransportProduceData
	} as unknown as WebRtcTransport;

	peer.transports.set(transport.id, transport);
    
	const context = {
		peer,
		response: {},
		message: {
			method: 'produceData',
			data: {
				transportId: 'id',
				appData,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	const spyDelete = jest.spyOn(peer.dataProducers, 'delete');

	producerMock.emit('close');

	expect(notify.mock.calls[0][0].method).toBe('dataProducerClosed');
	expect(spyDelete).toHaveBeenCalled();
});

test.each([
	[ 'requestConsumerKeyFrame', 'consumer' ],
	[ 'setConsumerPriority', 'consumer' ],
	[ 'setConsumerPreferredLayers', 'consumer' ],
	[ 'pauseConsumer', 'consumer' ],
	[ 'resumeConsumer', 'consumer' ],
	[ 'closeDataProducer', 'dataProducer' ],
	[ 'closeProducer', 'producer' ],
	[ 'pauseProducer', 'producer' ],
	[ 'resumeProducer', 'producer' ],
])('%s() - Should throw on missing %s', async (methodToTest:string) => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const peer = {
		transports: new Map<string, WebRtcTransport>(),
		producers: new Map<string, Producer>(),
		consumers: new Map<string, Consumer>(),
		dataProducers: new Map<string, DataProducer>()
	} as unknown as Peer;

	const context = {
		peer,
		response: {},
		message: {
			method: methodToTest,
			data: {
				producerId: 'id',
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test.each([
	[ 'requestConsumerKeyFrame', 'requestKeyFrame', 'consumer' ],
	[ 'setConsumerPriority', 'setPriority', 'consumer' ],
	[ 'setConsumerPreferredLayers', 'setPreferredLayers', 'consumer' ],
	[ 'pauseConsumer', 'pause', 'consumer' ],
	[ 'resumeConsumer', 'resume', 'consumer' ],
	[ 'closeDataProducer', 'close', 'dataProducer' ],
	[ 'closeProducer', 'close', 'producer' ],
	[ 'pauseProducer', 'pause', 'producer' ],
	[ 'resumeProducer', 'resume', 'producer' ],
])('%s() - Should call %s on %s', async (methodToTest:string) => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createMediaMiddleware(options);

	const peer = {
		transports: new Map<string, WebRtcTransport>(),
		producers: new Map<string, Producer>(),
		consumers: new Map<string, Consumer>(),
		dataProducers: new Map<string, DataProducer>()
	} as unknown as Peer;
	const consumer = new ConsumerMock() as unknown as Consumer;
	const producer = new ProducerMock() as unknown as Producer;

	peer.consumers.set(consumer.id, consumer);
	peer.producers.set(producer.id, producer);
	peer.dataProducers.set(producer.id, producer as unknown as DataProducer);

	const context = {
		peer,
		response: {},
		message: {
			method: methodToTest,
			data: {
				producerId: 'id',
				dataProducerId: 'id',
				consumerId: 'id',
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
});
