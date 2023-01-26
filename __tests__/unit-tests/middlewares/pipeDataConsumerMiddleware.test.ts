import { Next } from 'edumeet-common';
import { PipeDataConsumer } from '../../../src/media/PipeDataConsumer';
import { createPipeDataConsumerMiddleware } from '../../../src/middlewares/pipeDataConsumerMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const pipeDataConsumer = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as PipeDataConsumer;

	const sut = createPipeDataConsumerMiddleware({ pipeDataConsumer });

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
				pipeDataConsumerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('pipeDataConsumerClosed() - Should close pipeDataConsumer', async () => {
	const close = jest.fn();
	const pipeDataConsumer = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as PipeDataConsumer;

	const sut = createPipeDataConsumerMiddleware({ pipeDataConsumer });

	const context = {
		message: {
			method: 'pipeDataConsumerClosed',
			data: {
				routerId: ID,
				pipeDataConsumerId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});
