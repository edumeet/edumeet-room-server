import { createPrivateChatMiddleware } from '../../../src/middlewares/privateChatMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

const createRoom = (recipient?: unknown) => ({
	id: 'id',
	sessionId: 'id1',
	chatHistory: [],
	notifyPeers: jest.fn(),
	getPeerById: jest.fn(() => recipient)
} as unknown as Room);

test('Should throw on peer not authorized', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom() });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => false) };
	const message = { method: 'privateChatMessage', data: { text: 'text', to: 'peer2' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should throw on missing recipient', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom() });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'text' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should throw on message to self', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom() });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'text', to: 'peer1' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should throw on a message that is not a string', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom() });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: { evil: true }, to: 'peer2' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should throw on an empty message', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom() });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: '', to: 'peer2' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should throw on an over long message', async () => {
	const recipient = { id: 'peer2', notify: jest.fn() };
	const sut = createPrivateChatMiddleware({ room: createRoom(recipient) });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'a'.repeat(10001), to: 'peer2' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
	expect(recipient.notify).not.toHaveBeenCalled();
});

test('Should throw on unknown recipient', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom(undefined) });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'text', to: 'peer2' } };

	const context = { peer, message } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('Should notify only the recipient on authorized peer sending private chat message', async () => {
	const spyNotify = jest.fn();
	const recipient = { id: 'peer2', notify: spyNotify };
	const room = createRoom(recipient);
	const sut = createPrivateChatMiddleware({ room });

	const peer = { id: 'peer1', displayName: 'Peer One', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'text', to: 'peer2' } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await sut(context, next);

	expect(room.getPeerById).toHaveBeenCalledWith('peer2');
	expect(spyNotify).toHaveBeenCalledTimes(1);

	const notification = spyNotify.mock.calls[0][0];

	expect(notification.method).toBe('privateChatMessage');
	expect(notification.data.chatMessage).toEqual(expect.objectContaining({
		text: 'text',
		peerId: 'peer1',
		to: 'peer2',
		displayName: 'Peer One'
	}));
	expect(context.handled).toBeTruthy();
	expect(next).toHaveBeenCalled();
});

test('Should not store history and should not notify the room', async () => {
	const recipient = { id: 'peer2', notify: jest.fn() };
	const room = createRoom(recipient);
	const sut = createPrivateChatMiddleware({ room });

	const peer = { id: 'peer1', displayName: 'Peer One', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'text', to: 'peer2' } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await sut(context, next);

	expect(room.chatHistory).toHaveLength(0);
	expect(room.notifyPeers).not.toHaveBeenCalled();
});

test('Should not consult the session of either peer', async () => {
	const recipient = { id: 'peer2', notify: jest.fn(), sessionId: 'breakout1' };
	const room = createRoom(recipient);
	const sut = createPrivateChatMiddleware({ room });

	const peer = { id: 'peer1', sessionId: 'breakout2', hasPermission: jest.fn(() => true) };
	const message = { method: 'privateChatMessage', data: { text: 'text', to: 'peer2' } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await sut(context, next);

	expect(recipient.notify).toHaveBeenCalledTimes(1);
	expect(context.handled).toBeTruthy();
});

test('Should call next middleware if not private chat message', async () => {
	const sut = createPrivateChatMiddleware({ room: createRoom() });

	const peer = { id: 'peer1', hasPermission: jest.fn(() => true) };
	const message = {};

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await sut(context, next);

	expect(next).toHaveBeenCalled();
	expect(context.handled).toBeFalsy();
});
