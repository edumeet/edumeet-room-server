import { createPeerMiddleware } from '../../../src/middlewares/peerMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

const createRoom = () => ({
	id: 'id',
	sessionId: 'id1',
	notifyPeers: jest.fn()
} as unknown as Room);

test('Should throw on a display name that is not a string', async () => {
	const room = createRoom();
	const sut = createPeerMiddleware({ room });

	const peer = { id: 'peer1', displayName: 'Peer One' };
	const message = { method: 'changeDisplayName', data: { displayName: { evil: true } } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
	expect(peer.displayName).toBe('Peer One');
	expect(room.notifyPeers).not.toHaveBeenCalled();
});

test('Should throw on an empty display name', async () => {
	const room = createRoom();
	const sut = createPeerMiddleware({ room });

	const peer = { id: 'peer1', displayName: 'Peer One' };
	const message = { method: 'changeDisplayName', data: { displayName: '   ' } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
	expect(peer.displayName).toBe('Peer One');
});

test('Should throw on an over long display name', async () => {
	const room = createRoom();
	const sut = createPeerMiddleware({ room });

	const peer = { id: 'peer1', displayName: 'Peer One' };
	const message = { method: 'changeDisplayName', data: { displayName: 'a'.repeat(129) } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
	expect(peer.displayName).toBe('Peer One');
});

test('Should notify peers on a valid display name', async () => {
	const room = createRoom();
	const sut = createPeerMiddleware({ room });

	const peer = { id: 'peer1', displayName: 'Peer One' };
	const message = { method: 'changeDisplayName', data: { displayName: 'Peer Two' } };

	const context = { peer, message, handled: false } as unknown as PeerContext;

	await sut(context, next);

	expect(peer.displayName).toBe('Peer Two');
	expect(room.notifyPeers).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
});
