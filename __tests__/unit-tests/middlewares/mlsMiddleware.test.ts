import { createMlsMiddleware } from '../../../src/middlewares/mlsMiddleware';
import { PeerContext } from '../../../src/Peer';
import { MAX_MLS_JOINS_PER_MINUTE, MAX_MLS_KEY_PACKAGE_REQUESTS_PER_MINUTE, MAX_MLS_PROPOSALS_PER_MINUTE, RateLimiter } from '../../../src/common/rateLimiter';
import Room from '../../../src/Room';

const next = jest.fn();

afterEach(() => {
	jest.clearAllMocks();
});

type FakePeer = {
	id: string; notify: jest.Mock; once: jest.Mock; closeHandlers: Array<() => void>;
	connections: { items: unknown[] }; mlsJoins: RateLimiter; mlsKeyPackageRequests: RateLimiter; mlsProposals: RateLimiter;
};

const fakePeer = (id: string): FakePeer => {
	const peer: FakePeer = {
		id,
		notify: jest.fn(),
		once: jest.fn(),
		closeHandlers: [],
		connections: { items: [] },
		mlsJoins: new RateLimiter(MAX_MLS_JOINS_PER_MINUTE, 60_000),
		mlsKeyPackageRequests: new RateLimiter(MAX_MLS_KEY_PACKAGE_REQUESTS_PER_MINUTE, 60_000),
		mlsProposals: new RateLimiter(MAX_MLS_PROPOSALS_PER_MINUTE, 60_000),
	};

	peer.once.mockImplementation((event: string, handler: () => void) => {
		if (event === 'close') peer.closeHandlers.push(handler);
	});

	return peer;
};

const setup = () => {
	const peers = new Map<string, FakePeer>([ 'alice', 'bob', 'carol', 'dave' ].map((id) => [ id, fakePeer(id) ]));
	const roomCloseHandlers: Array<() => void> = [];
	const contentClearedHandlers: Array<() => void> = [];
	const room = {
		sessionId: 'session',
		endToEndEncryption: true,
		notifyPeers: jest.fn(),
		getPeerById: jest.fn((id: string) => peers.get(id)),
		on: jest.fn((event: string, handler: () => void) => {
			if (event === 'contentCleared') contentClearedHandlers.push(handler);
		}),
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
	// A member of the group leaves, which gives a reason for the next commit.
	const depart = async (peerId: string) => {
		await run(peerId, 'mlsKeyPackage', { keyPackage: 'k' });
		close(peerId);
	};
	const closeRoom = () => roomCloseHandlers.forEach((h) => h());
	const clearContent = () => contentClearedHandlers.forEach((h) => h());

	return { room, peers, run, close, depart, closeRoom, clearContent };
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
	const { room, peers, run, depart } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	await depart('dave');

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
	const { room, run, depart } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	await depart('dave');
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

test('A Welcome goes to each listed peer once, and an oversized list is refused', async () => {
	const { peers, run, depart } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	await depart('dave');

	await expect(run('alice', 'mlsCommit', {
		epoch: 0, commit: 'c1', groupInfo: 'gi1', welcome: 'w1', welcomeTo: Array(1000).fill('carol'),
	})).rejects.toThrow('invalid welcome');
	expect(peers.get('carol')?.notify).not.toHaveBeenCalled();

	await run('alice', 'mlsCommit', { epoch: 0, commit: 'c1', groupInfo: 'gi1', welcome: 'w1', welcomeTo: [ 'carol', 'carol', 'carol' ] });
	expect(peers.get('carol')?.notify).toHaveBeenCalledTimes(1);
});

test('A room whose content is cleared starts a new group for the next meeting', async () => {
	const { run, clearContent } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
	clearContent();

	expect((await run('bob', 'mlsJoin')).response).toMatchObject({ role: 'founder' });
});

// mlsJoin answers a joiner with the stored GroupInfo, up to a megabyte per request.
describe('the GroupInfo', () => {
	const founded = async () => {
		const s = setup();

		await s.run('alice', 'mlsJoin');
		await s.run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'g'.repeat(1000) });

		return s;
	};

	test('is handed to one peer only so often; then the peer is told to wait', async () => {
		const { run } = await founded();

		for (let i = 0; i < MAX_MLS_JOINS_PER_MINUTE; i++)
			expect((await run('bob', 'mlsJoin')).response).toMatchObject({ role: 'joiner' });

		const refused = await run('bob', 'mlsJoin');

		expect(refused.response).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
		expect(refused.handled).toBe(true);
	});

	test('asking while there is none to hand out is not counted', async () => {
		const { peers, run } = setup();

		await run('alice', 'mlsJoin');
		// bob waits for the founder and asks again every half second
		for (let i = 0; i < 5 * MAX_MLS_JOINS_PER_MINUTE; i++) await run('bob', 'mlsJoin');

		expect(peers.get('bob')?.mlsJoins.take()).toBe(true);
		await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });
		expect((await run('bob', 'mlsJoin')).response).toMatchObject({ role: 'joiner' });
	});
});

test('The key packages of all peers are handed to one peer only so often', async () => {
	const { run } = setup();

	await run('alice', 'mlsJoin');

	for (let i = 0; i < MAX_MLS_KEY_PACKAGE_REQUESTS_PER_MINUTE; i++)
		expect((await run('bob', 'mlsKeyPackages')).response).toHaveProperty('keyPackages');

	await expect(run('bob', 'mlsKeyPackages')).rejects.toThrow('Too many requests');
	expect((await run('carol', 'mlsKeyPackages')).response).toHaveProperty('keyPackages');
});

test('In a room without end-to-end encryption no MLS message is taken or passed on', async () => {
	const { room, run } = setup();

	(room as unknown as { endToEndEncryption: boolean }).endToEndEncryption = false;

	for (const method of [ 'mlsJoin', 'mlsEpoch', 'mlsGroupInfo', 'mlsCommit', 'mlsKeyPackage', 'mlsKeyPackages', 'mlsProposal' ])
		await expect(run('alice', method, { epoch: 0, groupInfo: 'gi', commit: 'c', keyPackage: 'k', proposal: 'p' })).rejects.toThrow('end-to-end encryption is off');

	expect(room.notifyPeers).not.toHaveBeenCalled();

	// Other requests go on to the next middleware as before.
	const other = await run('alice', 'chatMessage', {});

	expect(other.handled).toBe(false);
});

test('A member that offers commits in a loop gets none passed on without a reason, and proposals only so often', async () => {
	const { room, run, depart } = setup();

	await run('alice', 'mlsJoin');
	await run('alice', 'mlsGroupInfo', { epoch: 0, groupInfo: 'gi0' });

	for (let i = 0; i < 50; i++)
		expect((await run('carol', 'mlsCommit', { epoch: 0, commit: 'c', groupInfo: 'gi' })).response).toEqual({ accepted: false, epoch: 0 });

	expect(room.notifyPeers).not.toHaveBeenCalled();

	await depart('dave');
	expect((await run('carol', 'mlsCommit', { epoch: 0, commit: 'c', groupInfo: 'gi' })).response).toEqual({ accepted: true, epoch: 1 });
	expect((await run('carol', 'mlsCommit', { epoch: 1, commit: 'c', groupInfo: 'gi' })).response).toEqual({ accepted: false, epoch: 1 });
	expect(room.notifyPeers).toHaveBeenCalledTimes(1);

	for (let i = 0; i < MAX_MLS_PROPOSALS_PER_MINUTE; i++) await run('bob', 'mlsProposal', { proposal: 'p' });
	await expect(run('bob', 'mlsProposal', { proposal: 'p' })).rejects.toThrow('Too many requests');
});
