import 'jest';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import { Permission, updatePeerPermissions } from '../../src/common/authorization';
import { botProfile } from '../../src/common/botProfile';

const PARTICIPANT = [ Permission.SEND_CHAT, Permission.SHARE_AUDIO, Permission.SHARE_VIDEO ];

const created: Peer[] = [];

const makePeer = (managedId?: string, headless = false): Peer => {
	const peer = new Peer({ id: `p-${created.length}`, sessionId: 's', reconnectKey: 'k', managedId, headless });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const lockedEmptyRoom = (): Room => {
	const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

	room.defaultRole = { id: 1, name: 'participant', permissions: PARTICIPANT.map((name) => ({ name })) } as unknown as Room['defaultRole'];
	room.locked = true;
	room.resolveRoomReady();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	jest.spyOn(room as any, 'assignRouter').mockResolvedValue(undefined);

	return room;
};

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
});

describe('a guest who arrives first at a locked, empty unmanaged room', () => {
	test('waits in the lobby without moderator rights and is let in with the default role only', async () => {
		const room = lockedEmptyRoom();
		const guest = makePeer();

		await room.addPeer(guest);

		expect(room.lobbyPeers.items).toContain(guest);
		expect(guest.permissions.sort()).toEqual([ ...PARTICIPANT ].sort());
		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);

		// A signed-in organiser arrives, gets in as first participant and lets the guest in.
		const organiser = makePeer('42');

		await room.addPeer(organiser);
		room.joinPeer(organiser);
		expect(organiser.hasPermission(Permission.MODERATE_ROOM)).toBe(true);

		room.promotePeer(guest);
		room.joinPeer(guest);

		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(guest.hasPermission(Permission.CHANGE_ROOM_LOCK)).toBe(false);
		expect(guest.peerInfo.moderator).toBe(false);
		expect(organiser.hasPermission(Permission.MODERATE_ROOM)).toBe(true);
	});

	test('gets no moderator rights from a token update while it waits', async () => {
		const room = lockedEmptyRoom();
		const guest = makePeer();

		await room.addPeer(guest);
		updatePeerPermissions(room, guest, true);

		expect(room.lobbyPeers.items).toContain(guest);
		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
	});

	test('a signed-in user who arrives first still gets in as moderator', async () => {
		const room = lockedEmptyRoom();
		const organiser = makePeer('42');

		await room.addPeer(organiser);

		expect(room.lobbyPeers.items).not.toContain(organiser);
		expect(organiser.hasPermission(Permission.MODERATE_ROOM)).toBe(true);
	});
});

test('A bot parked in the lobby of an unmanaged room keeps the bot profile, also when it is let in', async () => {
	const room = lockedEmptyRoom();
	const organiser = makePeer('42');

	await room.addPeer(organiser);
	room.joinPeer(organiser);

	const bot = makePeer(undefined, true);

	await room.addPeer(bot);
	expect(room.lobbyPeers.items).toContain(bot);
	expect(bot.permissions).toEqual(botProfile.permissions);

	room.promotePeer(bot);
	expect(bot.hasPermission(Permission.SHARE_AUDIO)).toBe(false);
	expect(bot.hasPermission(Permission.SHARE_VIDEO)).toBe(false);
});
