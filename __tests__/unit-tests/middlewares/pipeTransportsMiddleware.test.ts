import { Next } from 'edumeet-common';
import { PipeTransport } from '../../../src/media/PipeTransport';
import { createPipeTransportsMiddleware } from '../../../src/middlewares/pipeTransportsMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const pipeTransport = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as PipeTransport;

	const pipeTransports = new Map<string, PipeTransport>();

	pipeTransports.set(pipeTransport.id, pipeTransport);

	const sut = createPipeTransportsMiddleware({
		routerId: pipeTransport.router.id,
		pipeTransports
	});

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
				pipeTransportId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('pipeTransportClosed() - Should close pipeTransport', async () => {
	const close = jest.fn();
	const pipeTransport = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as PipeTransport;

	const pipeTransports = new Map<string, PipeTransport>();

	pipeTransports.set(pipeTransport.id, pipeTransport);

	const sut = createPipeTransportsMiddleware({
		routerId: pipeTransport.router.id,
		pipeTransports
	});

	const context = {
		message: {
			method: 'pipeTransportClosed',
			data: {
				routerId: ID,
				pipeTransportId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});
