import { Next } from 'edumeet-common';
import { PipeDataProducer } from '../../../src/media/PipeDataProducer';
import { PipeProducer } from '../../../src/media/PipeProducer';
import { createPipeProducerMiddleware } from '../../../src/middlewares/pipeProducerMiddleware';
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

	const sut = createPipeProducerMiddleware({ pipeProducer });

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

test('pipeDataProducerClosed() - Should close pipeDataProducer', async () => {
	const close = jest.fn();
	const pipeProducer = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as PipeProducer;

	const sut = createPipeProducerMiddleware({ pipeProducer });

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
