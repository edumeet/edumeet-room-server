import { Next } from 'edumeet-common';
import { PipeDataProducer } from '../../../src/media/PipeDataProducer';
import { createPipeDataProducersMiddleware } from '../../../src/middlewares/pipeDataProducersMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const pipeDataProducer = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as PipeDataProducer;

	const pipeDataProducers = new Map<string, PipeDataProducer>();

	pipeDataProducers.set(pipeDataProducer.id, pipeDataProducer);

	const sut = createPipeDataProducersMiddleware({
		routerId: pipeDataProducer.router.id,
		pipeDataProducers
	});

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
				pipeDataProducerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('pipeDataProducerClosed() - Should close pipeDataProducer', async () => {
	const close = jest.fn();
	const pipeDataProducer = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as PipeDataProducer;

	const pipeDataProducers = new Map<string, PipeDataProducer>();

	pipeDataProducers.set(pipeDataProducer.id, pipeDataProducer);

	const sut = createPipeDataProducersMiddleware({
		routerId: pipeDataProducer.router.id,
		pipeDataProducers
	});

	const context = {
		message: {
			method: 'pipeDataProducerClosed',
			data: {
				routerId: ID,
				pipeDataProducerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});
