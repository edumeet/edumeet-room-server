import { Next } from 'edumeet-common';
import { PipeConsumer } from '../../../src/media/PipeConsumer';
import { createPipeConsumersMiddleware } from '../../../src/middlewares/pipeConsumersMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const pipeConsumer = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as PipeConsumer;

	const pipeConsumers = new Map<string, PipeConsumer>();

	pipeConsumers.set(pipeConsumer.id, pipeConsumer);

	const sut = createPipeConsumersMiddleware({
		routerId: pipeConsumer.router.id,
		pipeConsumers
	});

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
				pipeConsumerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('pipeConsumerClosed() - Should close pipeConsumer', async () => {
	const close = jest.fn();
	const pipeConsumer = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as PipeConsumer;

	const pipeConsumers = new Map<string, PipeConsumer>();

	pipeConsumers.set(pipeConsumer.id, pipeConsumer);

	const sut = createPipeConsumersMiddleware({
		routerId: pipeConsumer.router.id,
		pipeConsumers
	});

	const context = {
		message: {
			method: 'pipeConsumerClosed',
			data: {
				routerId: ID,
				pipeConsumerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});

test('pipeConsumerPaused() - Should pause pipeConsumer', async () => {
	const setProducerPaused = jest.fn();
	const pipeConsumer = {
		id: ID,
		router: {
			id: ID
		},
		setProducerPaused
	} as unknown as PipeConsumer;

	const pipeConsumers = new Map<string, PipeConsumer>();

	pipeConsumers.set(pipeConsumer.id, pipeConsumer);

	const sut = createPipeConsumersMiddleware({
		routerId: pipeConsumer.router.id,
		pipeConsumers
	});

	const context = {
		message: {
			method: 'pipeConsumerPaused',
			data: {
				routerId: ID,
				pipeConsumerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(setProducerPaused).toHaveBeenCalled();
});

test('pipeConsumerResumed() - Should pause pipeConsumer', async () => {
	const setProducerResumed = jest.fn();
	const pipeConsumer = {
		id: ID,
		router: {
			id: ID
		},
		setProducerResumed
	} as unknown as PipeConsumer;

	const pipeConsumers = new Map<string, PipeConsumer>();

	pipeConsumers.set(pipeConsumer.id, pipeConsumer);

	const sut = createPipeConsumersMiddleware({
		routerId: pipeConsumer.router.id,
		pipeConsumers
	});

	const context = {
		message: {
			method: 'pipeConsumerResumed',
			data: {
				routerId: ID,
				pipeConsumerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(setProducerResumed).toHaveBeenCalled();
});
