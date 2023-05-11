import { ChatMessage, MiddlewareOptions } from '../../../src/common/types';
import { createChatMiddleware } from '../../../src/middlewares/chatMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import * as checkSessionId from '../../../src/common/checkSessionId';
import { userRoles } from '../../../src/common/authorization';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

test('Should throw on peer not authorized', async () => {
	const room = { id: 'id', chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = { roles: [] };
	const message = { method: 'chatMessage' };

	const context = {
		peer,
		message,
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should call next middleware on wrong session', async () => {
	const spyThisSession = jest.spyOn(checkSessionId, 'thisSession');
	const room = { id: 'id', sessionId: 'id1', chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = { roles: [] };
	const message = { data: { sessionId: 'id2' } };

	const context = {
		peer,
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyThisSession).toHaveBeenCalled();
	expect(context.handled).toBeFalsy();
});

test('Should notify peers on authorized peer sending chat message', async () => {
	const spyNotify = jest.fn();
	const room = { id: 'id', notifyPeers: spyNotify, chatHistory: [], fileHistory: [] } as unknown as Room;
	const chatHistory: ChatMessage[] = [];
	const options = { room, chatHistory } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = { roles: [ userRoles.NORMAL ] };
	const message = {
		method: 'chatMessage',
		data: {

		}
	};

	const context = {
		peer,
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyNotify.mock.calls[0][0]).toBe('chatMessage');
	expect(context.handled).toBeTruthy();
});

test('Should call next middleware if not chat message', async () => {
	const room = { id: 'id', chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = { roles: [ userRoles.NORMAL ] };
	const message = {};

	const context = {
		peer,
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});