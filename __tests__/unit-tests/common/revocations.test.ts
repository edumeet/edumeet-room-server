import 'jest';
import Room from '../../../src/Room';
import BreakoutRoom from '../../../src/BreakoutRoom';
import { Peer, PeerContext } from '../../../src/Peer';
import MediaService from '../../../src/MediaService';
import {
	addGroupUser,
	addRoomOwner,
	changeDefaultRolePermission,
	Permission,
	removeGroupUser,
	removeRolePermission,
	removeRoomOwner,
	removeRoomUserRole,
	removeUser,
	updatePeerPermissions,
} from '../../../src/common/authorization';
import { createChatMiddleware } from '../../../src/middlewares/chatMiddleware';
import { createPrivateChatMiddleware } from '../../../src/middlewares/privateChatMiddleware';
import { createFileMiddleware } from '../../../src/middlewares/fileMiddleware';
import { ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoomOwner, ManagedUserRole } from '../../../src/common/types';

const opened: Array<Room | Peer> = [];

const role = (id: number, ...names: string[]) =>
	({ id, name: `role-${id}`, permissions: names.map((name, i) => ({ id: i + 1, name })) }) as unknown as ManagedRole;

const makeRoom = (managed: boolean, defaultRole?: ManagedRole): Room => {
	const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

	if (managed) room.managedId = '7';
	room.defaultRole = defaultRole;
	opened.push(room);

	return room;
};

const makePeer = (managedId?: string, permissions: string[] = []): Peer => {
	const peer = new Peer({ id: `p-${opened.length}`, managedId, sessionId: 's', reconnectKey: 'k', permissions });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	opened.push(peer);

	return peer;
};

// A user in the room with two sessions, as from two tabs with the same login.
const twoSessions = (room: Room, managedId: string): Peer[] => {
	const sessions = [ makePeer(managedId), makePeer(managedId) ];

	for (const peer of sessions) {
		room.joinPeer(peer);
		updatePeerPermissions(room, peer);
	}

	return sessions;
};

afterEach(() => {
	for (const item of opened.splice(0)) if (!item.closed) item.close();
	jest.restoreAllMocks();
});

const owner = { id: 1, roomId: '7', userId: '100' } as ManagedRoomOwner;
const has = (peers: Peer[], permission: Permission) => peers.map((p) => p.hasPermission(permission));

describe('a right taken from a user reaches every session of that user in the room', () => {
	test('room ownership', () => {
		const room = makeRoom(true);

		room.owners = [ owner ];

		const sessions = twoSessions(room, '100');

		expect(has(sessions, Permission.MODERATE_ROOM)).toEqual([ true, true ]);

		removeRoomOwner(room, owner);

		expect(has(sessions, Permission.MODERATE_ROOM)).toEqual([ false, false ]);
		expect(has(sessions, Permission.BYPASS_ROOM_LOCK)).toEqual([ false, false ]);
	});

	test('ownership given during the meeting reaches both sessions too', () => {
		const room = makeRoom(true);
		const sessions = twoSessions(room, '100');

		addRoomOwner(room, owner);

		expect(has(sessions, Permission.MODERATE_ROOM)).toEqual([ true, true ]);
	});

	test('a user role', () => {
		const room = makeRoom(true);
		const userRole = { id: 3, roomId: '7', userId: '100', roleId: '9', role: role(9, Permission.PROMOTE_PEER) } as unknown as ManagedUserRole;

		room.userRoles = [ userRole ];

		const sessions = twoSessions(room, '100');

		expect(has(sessions, Permission.PROMOTE_PEER)).toEqual([ true, true ]);

		removeRoomUserRole(room, userRole);

		expect(has(sessions, Permission.PROMOTE_PEER)).toEqual([ false, false ]);
	});

	test('a permission taken out of the user\'s role', () => {
		const room = makeRoom(true);

		room.userRoles = [ { id: 3, roomId: '7', userId: '100', roleId: '9', role: role(9, Permission.PROMOTE_PEER, Permission.SEND_CHAT) } as unknown as ManagedUserRole ];

		const sessions = twoSessions(room, '100');

		removeRolePermission(room, { roleId: '9', permission: { id: 1, name: Permission.PROMOTE_PEER } } as unknown as ManagedRolePermission);

		expect(has(sessions, Permission.PROMOTE_PEER)).toEqual([ false, false ]);
		expect(has(sessions, Permission.SEND_CHAT)).toEqual([ true, true ]);
	});

	test('membership of a group that has a role in the room', () => {
		const room = makeRoom(true);
		const groupUser = { id: 4, groupId: '50', userId: '100' } as unknown as ManagedGroupUser;

		room.groupRoles = [ { id: 5, roomId: '7', groupId: '50', roleId: '9', role: role(9, Permission.PROMOTE_PEER) } as unknown as ManagedGroupRole ];

		const sessions = twoSessions(room, '100');

		addGroupUser(room, groupUser);
		expect(has(sessions, Permission.PROMOTE_PEER)).toEqual([ true, true ]);

		removeGroupUser(room, groupUser);
		expect(has(sessions, Permission.PROMOTE_PEER)).toEqual([ false, false ]);
	});

	test('another user in the room is left alone', () => {
		const room = makeRoom(true);
		const other = { id: 2, roomId: '7', userId: '200' } as ManagedRoomOwner;

		room.owners = [ owner, other ];

		const [ kept ] = twoSessions(room, '200');

		removeRoomOwner(room, owner);

		expect(kept.hasPermission(Permission.MODERATE_ROOM)).toBe(true);
	});
});

describe('a deleted user', () => {
	test('is taken out of the owners and the user roles of a live room, so its token finds no rights there', () => {
		const room = makeRoom(true);

		room.owners = [ owner, { id: 2, roomId: '7', userId: '200' } as ManagedRoomOwner ];
		room.userRoles = [ { id: 3, roomId: '7', userId: '100', roleId: '9', role: role(9, Permission.PROMOTE_PEER) } as unknown as ManagedUserRole ];

		const revision = room.permissionsRevision;

		removeUser(room, { id: 100 });

		expect(room.owners).toEqual([ { id: 2, roomId: '7', userId: '200' } ]);
		expect(room.userRoles).toEqual([]);
		// Rights cached for a reconnect are from an older revision and are not handed back.
		expect(room.permissionsRevision).toBeGreaterThan(revision);

		// The user's token is valid until it expires: joining again with it gives nothing.
		const back = makePeer('100');

		room.joinPeer(back);
		updatePeerPermissions(room, back);

		expect(back.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(back.hasPermission(Permission.PROMOTE_PEER)).toBe(false);
	});

	test('changes nothing in a room where the user had no rights', () => {
		const room = makeRoom(true);

		room.owners = [ { id: 2, roomId: '7', userId: '200' } as ManagedRoomOwner ];

		const revision = room.permissionsRevision;

		removeUser(room, { id: 100 });

		expect(room.owners).toHaveLength(1);
		expect(room.permissionsRevision).toBe(revision);
	});
});

describe('a default role that gives MODERATE_ROOM to everyone in an unmanaged room', () => {
	const ALL = [ Permission.SEND_CHAT, Permission.PROMOTE_PEER, Permission.CHANGE_ROOM_LOCK, Permission.MODERATE_ROOM ];
	const remove = (room: Room, name: Permission) =>
		changeDefaultRolePermission(room, { roleId: '5', permission: { id: 99, name } } as unknown as ManagedRolePermission, false);

	test('loses a permission for every guest, also while the role still has MODERATE_ROOM', () => {
		const room = makeRoom(false, role(5, ...ALL));
		const first = makePeer(undefined, ALL);
		const guest = makePeer(undefined, ALL);

		room.joinPeer(first);
		room.joinPeer(guest);

		// The tenant admin takes the permissions out one at a time, MODERATE_ROOM last.
		remove(room, Permission.PROMOTE_PEER);
		expect(guest.hasPermission(Permission.PROMOTE_PEER)).toBe(false);

		remove(room, Permission.CHANGE_ROOM_LOCK);
		expect(guest.hasPermission(Permission.CHANGE_ROOM_LOCK)).toBe(false);

		remove(room, Permission.MODERATE_ROOM);
		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(guest.hasPermission(Permission.PROMOTE_PEER)).toBe(false);
		expect(guest.hasPermission(Permission.CHANGE_ROOM_LOCK)).toBe(false);

		// The room still has one moderator, with a moderator's rights.
		expect(first.hasPermission(Permission.MODERATE_ROOM)).toBe(true);
		expect(first.hasPermission(Permission.PROMOTE_PEER)).toBe(true);
	});
});

describe('a feature switched off during the meeting', () => {
	const sender = () => ({ id: 'a', hasPermission: () => true }) as unknown as Peer;
	const send = (middleware: ReturnType<typeof createChatMiddleware>, method: string, data: Record<string, unknown>) =>
		middleware({ peer: sender(), message: { method, data }, response: {} } as unknown as PeerContext, jest.fn());

	test('chat: a message from a participant who joined before is refused', async () => {
		const room = makeRoom(true);

		room.chatEnabled = false;

		await expect(send(createChatMiddleware({ room }), 'chatMessage', { text: 'hello' })).rejects.toThrow('chat is disabled');
		await expect(send(createPrivateChatMiddleware({ room }), 'privateChatMessage', { text: 'hello', to: 'b' })).rejects.toThrow('chat is disabled');
		expect(room.chatHistory).toHaveLength(0);
	});

	test('chat: also in a breakout room of that room', async () => {
		const room = makeRoom(true);
		const breakout = new BreakoutRoom({ parent: room, name: 'b' });

		room.chatEnabled = false;

		await expect(send(createChatMiddleware({ room: breakout }), 'chatMessage', { text: 'hello', sessionId: breakout.sessionId })).rejects.toThrow('chat is disabled');
		breakout.close();
	});

	test('file sharing: a file from a participant who joined before is refused', async () => {
		const room = makeRoom(true);

		room.filesharingEnabled = false;

		await expect(send(createFileMiddleware({ room }), 'sendFile', { magnetURI: 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a' })).rejects.toThrow('file sharing is disabled');
		expect(room.fileHistory).toHaveLength(0);
	});
});
