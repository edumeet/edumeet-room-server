import { Producer } from '../../../src/media/Producer';
import { MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { createProducersMiddleware } from '../../../src/middlewares/producersMiddleware';

const next = jest.fn();

test.each([
	[ 'id', 'id', 'id', 'wrong', false ],
	[ 'id', 'id', 'wrong', 'id', false ],
	[ 'id', 'wrong', 'id', 'id', false ],
	[ 'wrong', 'id', 'id', 'id', false ],
	[ 'id', 'id', 'id', 'id', true ]
])('Should not handle messages for wrong producer or router', async (routerId, routerIdInMessage, dataProducerId, dataProducerIdInMessage, wasHandled) => {
	const producer = {
		id: dataProducerId,
		router: {
			id: routerId
		},
		close: jest.fn()
	} as unknown as Producer;

	const producers = new Map<string, Producer>();

	producers.set(producer.id, producer);

	const sut = createProducersMiddleware({
		routerId: producer.router.id,
		producers
	});

	const context = {
		handled: false,
		message: {
			method: 'producerClosed',
			data: {
				routerId: routerIdInMessage,
				producerId: dataProducerIdInMessage
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBe(wasHandled);
});

test('Should not handle unrelated methods', async () => {
	const producer = {
		id: 'id',
		router: {
			id: 'id'
		},
	} as unknown as Producer;

	const producers = new Map<string, Producer>();

	producers.set(producer.id, producer);

	const sut = createProducersMiddleware({
		routerId: producer.router.id,
		producers
	});

	const context = {
		handled: false,
		message: {
			method: 'non-existing-method',
			data: {
				routerId: 'id',
				producerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeFalsy();
});

test('Should close producer', async () => {
	const spy = jest.fn();
	const producer = {
		id: 'id',
		router: {
			id: 'id'
		},
		close: spy
	} as unknown as Producer;

	const producers = new Map<string, Producer>();

	producers.set(producer.id, producer);

	const sut = createProducersMiddleware({
		routerId: producer.router.id,
		producers
	});

	const context = {
		handled: false,
		message: {
			method: 'producerClosed',
			data: {
				routerId: 'id',
				producerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalled();
});

test('Should set score', async () => {
	const spy = jest.fn();
	const producer = {
		id: 'id',
		router: {
			id: 'id'
		},
		setScore: spy
	} as unknown as Producer;

	const producers = new Map<string, Producer>();

	producers.set(producer.id, producer);

	const sut = createProducersMiddleware({
		routerId: producer.router.id,
		producers
	});

	const context = {
		handled: false,
		message: {
			method: 'producerScore',
			data: {
				score: 'score',
				routerId: 'id',
				producerId: 'id'
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeTruthy();
	expect(spy).toHaveBeenCalledWith('score');
});
