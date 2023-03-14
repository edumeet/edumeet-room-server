import { Next } from 'edumeet-common';
import { PipeProducer } from '../../../src/media/PipeProducer';
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

	const sut = createPipeProducersMiddleware({
		routerId: pipeProducer.router.id,
		pipeProducers
	});

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

	const sut = createPipeProducersMiddleware({
		routerId: pipeProducer.router.id,
		pipeProducers
	});

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
