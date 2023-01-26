import { userRoles } from '../../../src/common/authorization';
import { FileMessage, MiddlewareOptions } from '../../../src/common/types';
import { createFileMiddleware } from '../../../src/middlewares/fileMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';

test('Should not handle wrong session', async () => {
	const room = {
		id: 'id',
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createFileMiddleware(options);

	const next = jest.fn();
	const context = {
		handled: false,
		message: {
			method: 'sendFile',
			data: {
				sessionId: 'wrong session'
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('Should not handle unknown method', async () => {
	const room = {
		id: 'id',
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createFileMiddleware(options);

	const next = jest.fn();
	const context = {
		handled: false,
		message: {
			method: 'non-existing-method',
			data: {
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('sendFile() - Should throw on missing permissions', async () => {
	const room = {
		id: 'id',
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createFileMiddleware(options);
	const next = jest.fn();
	const peer = {
		roles: []
	} as unknown as Peer;
	const context = {
		peer,
		message: {
			method: 'sendFile',
			data: {
				sessionId: SESSION_ID
			}
		}
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('sendFile() - Should ', async () => {
	const spyNotifyPeers = jest.fn();
	const spyPushToHistory = jest.fn();
	const fileHistory = {
		push: spyPushToHistory
	} as unknown as FileMessage[];
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		notifyPeers: spyNotifyPeers
	} as unknown as Room;
	const options = { room, fileHistory } as MiddlewareOptions;
	const sut = createFileMiddleware(options);
	const peer = {
		roles: [ userRoles.NORMAL ] 
	};

	const next = jest.fn();
	const context = {
		handled: false,
		peer,
		message: {
			method: 'sendFile',
			data: {
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(spyNotifyPeers.mock.calls[0][0]).toBe('sendFile');
	expect(spyPushToHistory).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
});