import { Next } from 'edumeet-common';
import { PipeProducer } from '../../../src/media/PipeProducer';
import { Router } from '../../../src/media/Router';
import { createPipeProducersMiddleware } from '../../../src/middlewares/pipeProducersMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const pipeProducer = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as PipeProducer;

	const pipeProducers = new Map<string, PipeProducer>();

	pipeProducers.set(pipeProducer.id, pipeProducer);

	const router = {
		id: ID,
		pipeProducers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createPipeProducersMiddleware({ routers });

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
				pipeProducerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('pipeProducerClosed() - Should close pipeProducer', async () => {
	const close = jest.fn();
	const pipeProducer = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as PipeProducer;

	const pipeProducers = new Map<string, PipeProducer>();

	pipeProducers.set(pipeProducer.id, pipeProducer);

	const router = {
		id: ID,
		pipeProducers
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createPipeProducersMiddleware({ routers });

	const context = {
		message: {
			method: 'pipeProducerClosed',
			data: {
				routerId: ID,
				pipeProducerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});
