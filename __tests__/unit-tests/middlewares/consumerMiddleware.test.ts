import exp from 'constants';
import { Consumer } from '../../../src/media/Consumer';
import { MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { createConsumerMiddleware } from '../../../src/middlewares/consumerMiddleware';

const next = jest.fn();

test.each([
	[ 'id', 'id', 'id', 'wrong' ],
	[ 'id', 'id', 'wrong', 'id' ],
	[ 'id', 'wrong', 'id', 'id' ],
	[ 'wrong', 'id', 'id', 'id' ]
])('Should not handle messages for wrong consumer or router', async (routerId, routerIdInMessage, consumerId, consumerIdInMessage) => {
	const consumer = {
		id: consumerId,
		router: {
			id: routerId
		}
	} as unknown as Consumer;
	const sut = createConsumerMiddleware({ consumer });

	const context = {
		handled: false,
		message: {
			data: {
				routerId: routerIdInMessage,
				consumerId: consumerIdInMessage
			}
		}
	} as MediaNodeConnectionContext;

	await sut(context, next);
	expect(context.handled).toBeFalsy();
});

test('Should not handle unrelated methods', async () => {
	const consumer = {
		id: 'id',
		router: {
			id: 'id'
		},
	} as unknown as Consumer;
	const sut = createConsumerMiddleware({ consumer });

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
	const sut = createConsumerMiddleware({ consumer });

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
	const sut = createConsumerMiddleware({ consumer });

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
	const sut = createConsumerMiddleware({ consumer });

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
	const sut = createConsumerMiddleware({ consumer });

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
	const sut = createConsumerMiddleware({ consumer });

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