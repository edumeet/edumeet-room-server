import { Consumer } from '../../../src/media/Consumer';
import { MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { Router } from '../../../src/media/Router';
import { createConsumersMiddleware } from '../../../src/middlewares/consumersMiddleware';

const next = jest.fn();

test.each([
	[ 'id', 'id', 'id', 'wrong', false ],
	[ 'id', 'id', 'wrong', 'id', false ],
	[ 'id', 'wrong', 'id', 'id', false ],
	[ 'wrong', 'id', 'id', 'id', false ],
	[ 'id', 'id', 'id', 'id', true ]
])('Should not handle messages for wrong consumer or router', async (routerId, routerIdInMessage, dataConsumerId, dataConsumerIdInMessage, wasHandled) => {
	const consumer = {
		id: dataConsumerId,
		router: {
			id: routerId
		},
		close: jest.fn()
	} as unknown as Consumer;

	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: routerId,
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'consumerClosed',
			data: {
				routerId: routerIdInMessage,
				consumerId: dataConsumerIdInMessage
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBe(wasHandled);
});

test('Should not handle unrelated methods', async () => {
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
	} as unknown as Consumer;

	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: 'id',
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'non-existing-method',
			data: {
				routerId: 'id',
				consumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeFalsy();
});

test('Should close consumer', async () => {
	const spy = jest.fn();
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
		close: spy
	} as unknown as Consumer;

	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: 'id',
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'consumerClosed',
			data: {
				routerId: 'id',
				consumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalled();
});

test('Should pause producer', async () => {
	const spy = jest.fn();
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
		setProducerPaused: spy
	} as unknown as Consumer;

	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: 'id',
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'consumerProducerPaused',
			data: {
				routerId: 'id',
				consumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalled();
});

test('Should resume producer', async () => {
	const spy = jest.fn();
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
		setProducerResumed: spy
	} as unknown as Consumer;

	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: 'id',
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'consumerProducerResumed',
			data: {
				routerId: 'id',
				consumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalled();
});

test('Should set score', async () => {
	const spy = jest.fn();
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
		setScore: spy
	} as unknown as Consumer;
	
	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: 'id',
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'consumerScore',
			data: {
				score: 'score',
				routerId: 'id',
				consumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalledWith('score');
});

test('Should set consumers layer', async () => {
	const spy = jest.fn();
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
		setLayers: spy
	} as unknown as Consumer;
	
	const consumers = new Map<string, Consumer>();

	consumers.set(consumer.id, consumer);

	const router = {
		id: 'id',
		consumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'consumerLayersChanged',
			data: {
				layers: 'layers',
				routerId: 'id',
				consumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalledWith('layers');
});