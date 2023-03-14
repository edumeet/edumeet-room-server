import { DataConsumer } from '../../../src/media/DataConsumer';
import { MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { Router } from '../../../src/media/Router';
import { createDataConsumersMiddleware } from '../../../src/middlewares/dataConsumersMiddleware';

const next = jest.fn();

test.each([
	[ 'id', 'id', 'id', 'wrong', false ],
	[ 'id', 'id', 'wrong', 'id', false ],
	[ 'id', 'wrong', 'id', 'id', false ],
	[ 'wrong', 'id', 'id', 'id', false ],
	[ 'id', 'id', 'id', 'id', true ]
])('Should not handle messages for wrong consumer or router', async (routerId, routerIdInMessage, consumerId, consumerIdInMessage, wasHandled) => {
	const dataConsumer = {
		id: consumerId,
		router: {
			id: routerId
		},
		close: jest.fn()
	} as unknown as DataConsumer;

	const dataConsumers = new Map<string, DataConsumer>();

	dataConsumers.set(dataConsumer.id, dataConsumer);

	const router = {
		id: routerId,
		dataConsumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createDataConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'dataConsumerClosed',
			data: {
				routerId: routerIdInMessage,
				dataConsumerId: consumerIdInMessage
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBe(wasHandled);
});

test('Should not handle unrelated methods', async () => {
	const dataConsumer = {
		id: 'id',
		router: {
			id: 'id'
		},
	} as unknown as DataConsumer;
	
	const dataConsumers = new Map<string, DataConsumer>();

	dataConsumers.set(dataConsumer.id, dataConsumer);

	const router = {
		id: 'id',
		dataConsumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createDataConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'non-existing-method',
			data: {
				routerId: 'id',
				dataConsumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeFalsy();
});

test('Should close dataConsumer', async () => {
	const spy = jest.fn();
	const dataConsumer = {
		id: 'id',
		router: {
			id: 'id'
		},
		close: spy
	} as unknown as DataConsumer;
	
	const dataConsumers = new Map<string, DataConsumer>();

	dataConsumers.set(dataConsumer.id, dataConsumer);

	const router = {
		id: 'id',
		dataConsumers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createDataConsumersMiddleware({ routers });

	const context = {
		handled: false,
		message: {
			method: 'dataConsumerClosed',
			data: {
				routerId: 'id',
				dataConsumerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalled();
});
