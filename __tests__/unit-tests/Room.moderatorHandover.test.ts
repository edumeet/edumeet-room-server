import 'jest';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import { allPermissions, Permission } from '../../src/common/authorization';

const PARTICIPANT = [
	Permission.SEND_CHAT, Permission.SHARE_AUDIO, Permission.SHARE_VIDEO, Permission.SHARE_SCREEN,
	Permission.SHARE_EXTRA_VIDEO, Permission.SHARE_FILE, Permission.CHANGE_ROOM
];
const MODERATOR = allPermissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK);

const created: Peer[] = [];

const makePeer = (permissions: string[], options: { managedId?: string; headless?: boolean } = {}): Peer => {
	const peer = new Peer({ id: `p-${created.length}`, sessionId: 's', reconnectKey: 'k', permissions, ...options });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const makeRoom = (): Room => new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

// A room whose first participant is its moderator, as updatePeerPermissions() makes it, followed by others
const roomWith = (...peers: Peer[]): Room => {
	const room = makeRoom();

	peers.forEach((p) => room.joinPeer(p));

	return room;
};

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
});

describe('moderation in an unmanaged room', () => {
	test('passes to the participant who has been in the room longest when the moderator leaves', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);
		const third = makePeer(PARTICIPANT);
		const room = roomWith(moderator, second, third);

		room.removePeer(moderator);

		expect(second.permissions.sort()).toEqual([ ...MODERATOR ].sort());
		expect(second.notify).toHaveBeenCalledWith({ method: 'permissionAdded', data: { permission: Permission.MODERATE_ROOM } });
		expect(third.permissions.sort()).toEqual([ ...PARTICIPANT ].sort());
	});

	test('gives the new moderator the lobby list, as it is now the one to let people in', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);
		const room = roomWith(moderator, second);
		const waiting = makePeer(PARTICIPANT);

		room.lobbyPeers.add(waiting);
		room.removePeer(moderator);

		expect(second.notify).toHaveBeenCalledWith({ method: 'parkedPeers', data: { lobbyPeers: [ waiting.peerInfo ] } });
	});

	test('stays with the others while one moderator is left', () => {
		const moderator = makePeer(MODERATOR);
		const promoted = makePeer([ ...PARTICIPANT, Permission.MODERATE_ROOM ]);
		const third = makePeer(PARTICIPANT);
		const room = roomWith(moderator, third, promoted);

		room.removePeer(moderator);

		expect(third.permissions).not.toContain(Permission.MODERATE_ROOM);
	});

	test('is not passed when a participant who is not a moderator leaves', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);
		const third = makePeer(PARTICIPANT);
		const room = roomWith(moderator, second, third);

		room.removePeer(second);

		expect(third.permissions).not.toContain(Permission.MODERATE_ROOM);
	});

	test('skips bots, which never moderate', () => {
		const moderator = makePeer(MODERATOR);
		const bot = makePeer([], { headless: true });
		const human = makePeer(PARTICIPANT);
		const room = roomWith(moderator, bot, human);

		room.removePeer(moderator);

		expect(bot.permissions).toEqual([]);
		expect(human.permissions).toContain(Permission.MODERATE_ROOM);
	});

	test('gives BYPASS_ROOM_LOCK to a signed-in new moderator only, and never with unmanaged rooms disabled', () => {
		const anonymous = makePeer(PARTICIPANT);
		const signedIn = makePeer(PARTICIPANT, { managedId: 'u1' });

		const first = roomWith(makePeer(MODERATOR), anonymous);

		first.removePeer(first.participants[0]);
		expect(anonymous.permissions).not.toContain(Permission.BYPASS_ROOM_LOCK);

		const second = roomWith(makePeer(MODERATOR), signedIn);

		second.removePeer(second.participants[0]);
		expect(signedIn.permissions).toContain(Permission.BYPASS_ROOM_LOCK);

		const signedInDisabled = makePeer(PARTICIPANT, { managedId: 'u2' });
		const third = roomWith(makePeer(MODERATOR), signedInDisabled);

		third.disableUnmanaged = true;
		third.removePeer(third.participants[0]);
		expect(signedInDisabled.permissions).toContain(Permission.MODERATE_ROOM);
		expect(signedInDisabled.permissions).not.toContain(Permission.BYPASS_ROOM_LOCK);
	});

	test('goes to a peer that finishes joining after the last moderator left before it was in', () => {
		const room = roomWith(makePeer(MODERATOR));
		const joining = makePeer(PARTICIPANT);

		room.pendingPeers.add(joining);
		room.removePeer(room.participants[0]);

		expect(room.closed).toBe(false);

		room.joinPeer(joining);

		expect(joining.permissions).toContain(Permission.MODERATE_ROOM);
	});

	test('waits for a first participant still joining, who is the moderator, instead of making another one', () => {
		const room = makeRoom();
		const first = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);

		room.pendingPeers.add(first);
		room.joinPeer(second);

		expect(second.permissions).not.toContain(Permission.MODERATE_ROOM);
	});
});

describe('moderation in a managed room', () => {
	test('is not passed on: its owners and roles decide who moderates', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);
		const room = roomWith(moderator, second);

		room.managedId = '42';
		room.removePeer(moderator);

		expect(second.permissions).not.toContain(Permission.MODERATE_ROOM);
	});
});

describe('who moderates is visible to everyone', () => {
	test('the peer info says whether a peer moderates', () => {
		expect(makePeer(MODERATOR).peerInfo.moderator).toBe(true);
		expect(makePeer(PARTICIPANT).peerInfo.moderator).toBe(false);
	});

	test('a handover is announced to everyone, the new moderator included', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);
		const third = makePeer(PARTICIPANT);
		const room = roomWith(moderator, second, third);

		room.removePeer(moderator);

		for (const peer of [ second, third ])
			expect(peer.notify).toHaveBeenCalledWith({ method: 'moderatorHandover', data: { peerId: second.id } });
		expect(third.notify).toHaveBeenCalledWith({ method: 'peerModeratorChanged', data: { peerId: second.id, moderator: true } });
		expect(second.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'peerModeratorChanged' }));
	});

	test('a moderator promoted or demoted during the meeting is announced, with no handover notice', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);
		const room = roomWith(moderator, second);

		second.permissions = [ ...PARTICIPANT, Permission.MODERATE_ROOM ];
		expect(moderator.notify).toHaveBeenCalledWith({ method: 'peerModeratorChanged', data: { peerId: second.id, moderator: true } });

		second.permissions = PARTICIPANT;
		expect(moderator.notify).toHaveBeenCalledWith({ method: 'peerModeratorChanged', data: { peerId: second.id, moderator: false } });

		expect(moderator.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'moderatorHandover' }));
		expect(room.closed).toBe(false);
	});

	test('a change of other permissions is not announced', () => {
		const moderator = makePeer(MODERATOR);
		const second = makePeer(PARTICIPANT);

		roomWith(moderator, second);
		second.permissions = [ Permission.SEND_CHAT ];

		expect(moderator.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'peerModeratorChanged' }));
	});
});
