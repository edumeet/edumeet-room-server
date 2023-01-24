import { Next } from 'edumeet-common';
import { Router } from '../../../src/media/Router';
import { createRouterMiddleware } from '../../../src/middlewares/routerMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const router = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as Router; 

	const sut = createRouterMiddleware({ router });

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('routerClosed() - Should close router', async () => {
	const close = jest.fn();
	const router = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as Router; 

	const sut = createRouterMiddleware({ router });

	const context = {
		message: {
			method: 'routerClosed',
			data: {
				routerId: ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});
