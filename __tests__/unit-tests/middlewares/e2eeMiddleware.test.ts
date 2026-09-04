import { createE2eeMiddleware } from '../../../src/middlewares/e2eeMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

const setup = () => {
	const target = { id: 'bob', notify: jest.fn() };
	const room = {
		sessionId: 'session',
		notifyPeers: jest.fn(),
		getPeerById: jest.fn((id: string) => (id === 'bob' ? target : undefined)),
	} as unknown as Room;
	const sender = { id: 'alice' };
	const sut = createE2eeMiddleware({ room });

	const run = async (method: string, data: Record<string, unknown>) => {
		const context = { peer: sender, message: { method, data }, handled: false } as unknown as PeerContext;

		await sut(context, next);

		return context;
	};

	return { room, target, sender, run };
};

test('Should stamp the sender id on a broadcast identity and never let the client choose it', async () => {
	const { room, sender, run } = setup();

	const context = await run('e2eeIdentity', { identityPubKey: 'pub', peerId: 'mallory' });

	expect(room.notifyPeers).toHaveBeenCalledWith('e2eeIdentity', { identityPubKey: 'pub', peerId: 'alice' }, sender);
	expect(context.handled).toBe(true);
	expect(next).toHaveBeenCalled();
});

test('Should deliver a targeted identity to that peer only, with the target stripped', async () => {
	const { room, target, run } = setup();

	await run('e2eeIdentity', { identityPubKey: 'pub', toPeerId: 'bob' });

	expect(target.notify).toHaveBeenCalledWith({ method: 'e2eeIdentity', data: { identityPubKey: 'pub', peerId: 'alice' } });
	expect(room.notifyPeers).not.toHaveBeenCalled();
});

test('Should deliver a key to its target only and stamp the sender, ignoring a forged fromPeerId', async () => {
	const { room, target, run } = setup();

	await run('e2eeKey', { toPeerId: 'bob', keyId: 7, iv: 'iv', data: 'data', fromPeerId: 'mallory' });

	expect(target.notify).toHaveBeenCalledWith({ method: 'e2eeKey', data: { keyId: 7, iv: 'iv', data: 'data', fromPeerId: 'alice' } });
	expect(room.notifyPeers).not.toHaveBeenCalled();
});

test('Should drop a message for a peer that is not in the room without failing', async () => {
	const { room, target, run } = setup();

	const context = await run('e2eeKey', { toPeerId: 'nobody', keyId: 7, iv: 'iv', data: 'data' });

	expect(target.notify).not.toHaveBeenCalled();
	expect(room.notifyPeers).not.toHaveBeenCalled();
	expect(context.handled).toBe(true);
});

test('Should leave other methods to the next middleware', async () => {
	const { room, target, run } = setup();

	const context = await run('chatMessage', { text: 'hello' });

	expect(target.notify).not.toHaveBeenCalled();
	expect(room.notifyPeers).not.toHaveBeenCalled();
	expect(context.handled).toBe(false);
	expect(next).toHaveBeenCalled();
});
