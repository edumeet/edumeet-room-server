import { ChatMessage, MiddlewareOptions } from '../../../src/common/types';
import { MAX_CHAT_MESSAGES_PER_MINUTE, RateLimiter } from '../../../src/common/rateLimiter';
import { createChatMiddleware } from '../../../src/middlewares/chatMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import * as checkSessionId from '../../../src/common/checkSessionId';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

test('Should throw on peer not authorized', async () => {
	const room = { id: 'id', chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => false)
	};
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

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => true),
		chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000),
	};
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

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => true),
		chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000),
	};
	const message = {
		method: 'chatMessage',
		data: {
			text: 'text'
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

test('Should throw on a message that is not a string', async () => {
	const spyNotify = jest.fn();
	const room = { id: 'id', notifyPeers: spyNotify, chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => true),
		chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000),
	};
	const message = { method: 'chatMessage', data: { text: { evil: true } } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
	expect(spyNotify).not.toHaveBeenCalled();
	expect(room.chatHistory).toHaveLength(0);
});

test('Should throw on an empty message', async () => {
	const room = { id: 'id', notifyPeers: jest.fn(), chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => true),
		chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000),
	};
	const message = { method: 'chatMessage', data: { text: '   ' } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should throw on an over long message', async () => {
	const spyNotify = jest.fn();
	const room = { id: 'id', notifyPeers: spyNotify, chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => true),
		chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000),
	};
	const message = { method: 'chatMessage', data: { text: 'a'.repeat(10001) } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
	expect(spyNotify).not.toHaveBeenCalled();
	expect(room.chatHistory).toHaveLength(0);
});

test('Should call next middleware if not chat message', async () => {
	const room = { id: 'id', chatHistory: [], fileHistory: [] } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createChatMiddleware(options);

	const peer = {
		permissions: [],
		hasPermission: jest.fn(() => true),
		chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000),
	};
	const message = {};

	const context = {
		peer,
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('Should clean control characters and broken surrogate pairs out of a message, and keep tab and line breaks', async () => {
	const room = { id: 'id', notifyPeers: jest.fn(), chatHistory: [] as ChatMessage[], fileHistory: [] } as unknown as Room;
	const sut = createChatMiddleware({ room } as unknown as MiddlewareOptions);
	const peer = { id: 'p', displayName: 'P', permissions: [], hasPermission: jest.fn(() => true), chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000) };
	const send = (text: string) =>
		sut({ peer, message: { method: 'chatMessage', data: { text } }, handled: false } as unknown as PeerContext, next);
	const stored = () => room.chatHistory.map(({ text }) => text);

	jest.spyOn(checkSessionId, 'thisSession').mockReturnValue(true);

	await send('line one\nline two\r\n\tindented, zażółć 中文 🙂');
	// pasted from a slide (vertical tab) and from a PDF (form feed)
	await send('first\u000bsecond\u000cthird');
	await send('a\u0000b\u0007c\u001b[31md\u007fe\u0085f');
	await send('half \ud800 pair');

	expect(stored()).toEqual([
		'line one\nline two\r\n\tindented, zażółć 中文 🙂',
		'first\nsecond\nthird',
		'abc[31mdef',
		'half \ufffd pair',
	]);

	await expect(send('\u0000\u0001\u0002')).rejects.toThrow('invalid message');
	expect(room.chatHistory).toHaveLength(4);
});

test('A message in the main room goes to the others without being kept for recovery', async () => {
	const room = { id: 'id', notifyPeers: jest.fn(), notifyPeersOnce: jest.fn(), chatHistory: [], fileHistory: [] } as unknown as Room;
	const sut = createChatMiddleware({ room, inReconnectState: true });
	const peer = { id: 'p', displayName: 'P', permissions: [], hasPermission: jest.fn(() => true), chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000) };

	jest.spyOn(checkSessionId, 'thisSession').mockReturnValue(true);
	await sut({ peer, message: { method: 'chatMessage', data: { text: 'hi' } }, handled: false } as unknown as PeerContext, next);

	expect(room.notifyPeersOnce).toHaveBeenCalledWith('chatMessage', expect.objectContaining({ peerId: 'p' }), peer);
	expect(room.notifyPeers).not.toHaveBeenCalled();
});

test('The display name of a new peer is cleaned too, and one with nothing left is Guest', async () => {
	const { Peer } = await import('../../../src/Peer');

	expect(new Peer({ id: 'a', sessionId: 's', reconnectKey: 'k', displayName: 'Bob\u0007\tSmith' }).displayName).toBe('Bob  Smith');
	expect(new Peer({ id: 'b', sessionId: 's', reconnectKey: 'k', displayName: '\u0000\u0001' }).displayName).toBe('Guest');
});

test('A peer may send MAX_CHAT_MESSAGES_PER_MINUTE messages a minute, in rooms and privately together', async () => {
	const { createPrivateChatMiddleware } = await import('../../../src/middlewares/privateChatMiddleware');
	const suspiciousClients = await import('../../../src/common/suspiciousClients');
	const reported = jest.spyOn(suspiciousClients, 'limitHit').mockImplementation(() => undefined);
	const recipient = { id: 'q', notify: jest.fn() };
	const room = { id: 'id', notifyPeers: jest.fn(), chatHistory: [] as ChatMessage[], fileHistory: [], getPeerById: () => recipient } as unknown as Room;
	const peer = { id: 'p', displayName: 'P', permissions: [], connections: { items: [] }, hasPermission: () => true, chatMessages: new RateLimiter(MAX_CHAT_MESSAGES_PER_MINUTE, 60_000) };
	const chat = createChatMiddleware({ room });
	const privately = createPrivateChatMiddleware({ room });
	const send = (sut: typeof chat, method: string) =>
		sut({ peer, message: { method, data: { text: 'hi', to: 'q' } }, handled: false } as unknown as PeerContext, next);

	try {
		jest.spyOn(checkSessionId, 'thisSession').mockReturnValue(true);

		for (let i = 0; i < MAX_CHAT_MESSAGES_PER_MINUTE - 1; i++) await send(chat, 'chatMessage');
		await send(privately, 'privateChatMessage');

		await expect(send(chat, 'chatMessage')).rejects.toThrow('Too many messages');
		await expect(send(privately, 'privateChatMessage')).rejects.toThrow('Too many messages');
		expect(room.chatHistory).toHaveLength(MAX_CHAT_MESSAGES_PER_MINUTE - 1);
		expect(reported).toHaveBeenCalledTimes(2);
	} finally {
		reported.mockRestore();
	}
});
