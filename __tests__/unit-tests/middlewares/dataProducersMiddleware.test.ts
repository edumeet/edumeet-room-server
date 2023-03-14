import { DataProducer } from '../../../src/media/DataProducer';
import { MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { Router } from '../../../src/media/Router';
import { createDataProducersMiddleware } from '../../../src/middlewares/dataProducersMiddleware';

const next = jest.fn();

test.each([
	[ 'id', 'id', 'id', 'wrong', false ],
	[ 'id', 'id', 'wrong', 'id', false ],
	[ 'id', 'wrong', 'id', 'id', false ],
	[ 'wrong', 'id', 'id', 'id', false ],
	[ 'id', 'id', 'id', 'id', true ]
])('Should not handle messages for wrong consumer or router', async (routerId, routerIdInMessage, producerId, producerIdInMessage, wasHandled) => {
	const dataProducer = {
		id: producerId,
		router: {
			id: routerId
		},
		close: jest.fn()
	} as unknown as DataProducer;
	
	const dataProducers = new Map<string, DataProducer>();

	dataProducers.set(dataProducer.id, dataProducer);

	const router = {
		id: routerId,
		dataProducers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createDataProducersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'dataProducerClosed',
			data: {
				routerId: routerIdInMessage,
				dataProducerId: producerIdInMessage
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBe(wasHandled);
});

test('Should not handle unrelated methods', async () => {
	const dataProducer = {
		id: 'id',
		router: {
			id: 'id'
		},
	} as unknown as DataProducer;
	
	const dataProducers = new Map<string, DataProducer>();

	dataProducers.set(dataProducer.id, dataProducer);

	const router = {
		id: 'id',
		dataProducers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createDataProducersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'non-existing-method',
			data: {
				routerId: 'id',
				dataProducerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeFalsy();
});

test('Should close dataProducer', async () => {
	const spy = jest.fn();
	const dataProducer = {
		id: 'id',
		router: {
			id: 'id'
		},
		close: spy
	} as unknown as DataProducer;
	
	const dataProducers = new Map<string, DataProducer>();

	dataProducers.set(dataProducer.id, dataProducer);

	const router = {
		id: 'id',
		dataProducers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createDataProducersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'dataProducerClosed',
			data: {
				routerId: 'id',
				dataProducerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalled();
});
