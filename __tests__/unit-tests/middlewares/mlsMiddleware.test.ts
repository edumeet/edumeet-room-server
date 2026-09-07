import { createMlsMiddleware } from '../../../src/middlewares/mlsMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

type FakePeer = { id: string; notify: jest.Mock; once: jest.Mock; closeHandlers: Array<() => void> };

const fakePeer = (id: string): FakePeer => {
	const peer: FakePeer = { id, notify: jest.fn(), once: jest.fn(), closeHandlers: [] };

	peer.once.mockImplementation((event: string, handler: () => void) => {
		if (event === 'close') peer.closeHandlers.push(handler);
	});

	return peer;
};

const setup = () => {
	const peers = new Map<string, FakePeer>([ 'alice', 'bob', 'carol' ].map((id) => [ id, fakePeer(id) ]));
	const roomCloseHandlers: Array<() => void> = [];
	const room = {
		sessionId: 'session',
		notifyPeers: jest.fn(),
		getPeerById: jest.fn((id: string) => peers.get(id)),
		once: jest.fn((event: string, handler: () => void) => {
			if (event === 'close') roomCloseHandlers.push(handler);
		}),
	} as unknown as Room;
	const sut = createMlsMiddleware({ room });

	const run = async (peerId: string, method: string, data?: Record<string, unknown>) => {
		const context = { peer: peers.get(peerId), message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

		await sut(context, next);

		return context;
	};

	const close = (peerId: string) => peers.get(peerId)?.closeHandlers.forEach((h) => h());
	const closeRoom = () => roomCloseHandlers.forEach((h) => h());

	return { room, peers, run, close, closeRoom };
};

test('The first peer to join founds the group, the next waits, and after the founder publishes it gets the GroupInfo', async () => {
	const { run } = setup();

	expect((await run('alice', 'mlsJoin')).response).toEqual({ role: 'founder' });
	expect((await run('bob', 'mlsJoin')).response).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });

	const published = await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });

	expect(published.response).toEqual({ accepted: true, epoch: 0 });
	expect(published.handled).toBe(true);
	expect((await run('bob', 'mlsJoin')).response).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi0' });
	expect(next).toHaveBeenCalledTimes(4);
});

test('An accepted commit is relayed to everyone else with the server-stamped sender, and the Welcome only to its targets', async () => {
	const { room, peers, run } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });

	const context = await run('alice', 'mlsCommit', {
		epoch: 0, commit: 'c1', groupInfo: 'gi1', welcome: 'w1', welcomeTo: [ 'carol', 'nobody' ], fromPeerId: 'mallory',
	});

	expect(context.response).toEqual({ accepted: true, epoch: 1 });
	expect(room.notifyPeers).toHaveBeenCalledWith('mlsCommit', { fromPeerId: 'alice', epoch: 1, commit: 'c1' }, peers.get('alice'));
	expect(peers.get('carol')?.notify).toHaveBeenCalledWith({ method: 'mlsWelcome', data: { fromPeerId: 'alice', epoch: 1, welcome: 'w1' } });
	expect(peers.get('bob')?.notify).not.toHaveBeenCalled();
	expect((await run('bob', 'mlsJoin')).response).toEqual({ role: 'joiner', epoch: 1, groupInfo: 'gi1' });
});

test('A commit built on a stale epoch is refused with the current epoch and relayed to nobody', async () => {
	const { room, run } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	await run('alice', 'mlsCommit', { epoch: 0, commit: 'c1', groupInfo: 'gi1' });
	jest.clearAllMocks();

	const context = await run('bob', 'mlsCommit', { epoch: 0, commit: 'c1-bob', groupInfo: 'gi1-bob' });

	expect(context.response).toEqual({ accepted: false, epoch: 1 });
	expect(room.notifyPeers).not.toHaveBeenCalled();
	expect(context.handled).toBe(true);
});

test('Malformed MLS messages are refused before they touch the group', async () => {
	const { room, run } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });

	await expect(run('alice', 'mlsCommit', { epoch: 'zero', commit: 'c', groupInfo: 'gi' })).rejects.toThrow('invalid commit');
	await expect(run('alice', 'mlsCommit', { epoch: 0, commit: 42, groupInfo: 'gi' })).rejects.toThrow('invalid commit');
	await expect(run('alice', 'mlsCommit', { epoch: 0, commit: 'c', groupInfo: 'gi', welcome: 'w' })).rejects.toThrow('invalid welcome');
	await expect(run('alice', 'mlsCommit', { epoch: 0, commit: 'x'.repeat(5 * 1024 * 1024), groupInfo: 'gi' })).rejects.toThrow('invalid commit');
	await expect(run('alice', 'mlsGroupInfo', { epoch: -1, groupInfo: 'gi' })).rejects.toThrow('invalid group info');
	await expect(run('alice', 'mlsKeyPackage', { keyPackage: '' })).rejects.toThrow('invalid key package');
	await expect(run('alice', 'mlsProposal', { proposal: 'p', toPeerId: 7 })).rejects.toThrow('invalid proposal target');

	expect(room.notifyPeers).not.toHaveBeenCalled();
	expect((await run('bob', 'mlsJoin')).response).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi0' });
});

test('Key packages are stored per peer and forgotten when the peer closes', async () => {
	const { run, close } = setup();

	await run('alice', 'mlsKeyPackage', { keyPackage: 'kp-a' });
	await run('bob', 'mlsKeyPackage', { keyPackage: 'kp-b' });

	expect((await run('carol', 'mlsKeyPackages')).response).toEqual({ keyPackages: { alice: 'kp-a', bob: 'kp-b' } });

	close('bob');

	expect((await run('carol', 'mlsKeyPackages')).response).toEqual({ keyPackages: { alice: 'kp-a' } });
});

test('A founder that closes before publishing frees the role, and a room closing forgets the group', async () => {
	const { run, close, closeRoom } = setup();

	expect((await run('alice', 'mlsJoin')).response).toEqual({ role: 'founder' });
	close('alice');
	expect((await run('bob', 'mlsJoin')).response).toEqual({ role: 'founder' });

	await run('bob', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	closeRoom();

	expect((await run('carol', 'mlsJoin')).response).toEqual({ role: 'founder' });
});

test('Proposals are relayed to everyone else, or to one target, with the sender stamped', async () => {
	const { room, peers, run } = setup();

	await run('alice', 'mlsProposal', { proposal: 'p1', fromPeerId: 'mallory' });

	expect(room.notifyPeers).toHaveBeenCalledWith('mlsProposal', { fromPeerId: 'alice', proposal: 'p1' }, peers.get('alice'));

	await run('alice', 'mlsProposal', { proposal: 'p2', toPeerId: 'bob' });

	expect(peers.get('bob')?.notify).toHaveBeenCalledWith({ method: 'mlsProposal', data: { fromPeerId: 'alice', proposal: 'p2' } });
	expect(room.notifyPeers).toHaveBeenCalledTimes(1);
});

test('Messages for other middlewares pass through untouched', async () => {
	const { run } = setup();

	const context = await run('alice', 'chatMessage', { text: 'hi' });

	expect(context.handled).toBe(false);
	expect(next).toHaveBeenCalled();
});

test('The epoch can be read without taking a turn in the join queue', async () => {
	const { run } = setup();

	expect((await run('alice', 'mlsEpoch')).response).toEqual({ epoch: -1 });

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	await run('bob', 'mlsJoin');

	expect((await run('carol', 'mlsEpoch')).response).toEqual({ epoch: 0 });
	expect((await run('carol', 'mlsJoin')).response).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
});

test('A commit offered before any group exists is refused and relayed to nobody', async () => {
	const { room, run } = setup();

	const context = await run('alice', 'mlsCommit', { epoch: 0, commit: 'c', groupInfo: 'gi' });

	expect(context.response).toEqual({ accepted: false, epoch: -1 });
	expect(room.notifyPeers).not.toHaveBeenCalled();
});

test('Key packages and proposals have a smaller size limit than commits', async () => {
	const { run } = setup();

	await expect(run('alice', 'mlsKeyPackage', { keyPackage: 'k'.repeat((64 * 1024) + 1) })).rejects.toThrow('invalid key package');
	await expect(run('alice', 'mlsProposal', { proposal: 'p'.repeat((64 * 1024) + 1) })).rejects.toThrow('invalid proposal');
	await run('alice', 'mlsKeyPackage', { keyPackage: 'k'.repeat(64 * 1024) });

	expect((await run('bob', 'mlsKeyPackages')).response).toEqual({ keyPackages: { alice: 'k'.repeat(64 * 1024) } });
});

test('A joiner that closes while holding its turn frees it for the next', async () => {
	const { run, close } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });

	expect((await run('bob', 'mlsJoin')).response).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi0' });
	expect((await run('carol', 'mlsJoin')).response).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });

	close('bob');

	expect((await run('carol', 'mlsJoin')).response).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi0' });
});
