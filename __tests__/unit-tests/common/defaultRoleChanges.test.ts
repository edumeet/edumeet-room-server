import 'jest';
import Room from '../../../src/Room';
import { Peer } from '../../../src/Peer';
import MediaService from '../../../src/MediaService';
import { allPermissions, applyDefaultRole, applyTenantDefaultRole, changeDefaultRolePermission, Permission, removeRole, updateRoomDefaultRole } from '../../../src/common/authorization';
import { createModeratorMiddleware } from '../../../src/middlewares/moderatorMiddleware';
import { ManagedRole, ManagedRolePermission, ManagedRoom } from '../../../src/common/types';
import { PeerContext } from '../../../src/Peer';

const created: Peer[] = [];

const role = (id: number, ...names: string[]) =>
	({ id, name: `role-${id}`, permissions: names.map((name, i) => ({ id: i + 1, name })) }) as unknown as ManagedRole;

const makePeer = (permissions: string[] = []): Peer => {
	const peer = new Peer({ id: `p-${created.length}`, sessionId: 's', reconnectKey: 'k', permissions });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const makeRoom = (managed: boolean, defaultRole: ManagedRole): Room => {
	const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

	if (managed) room.managedId = '7';
	room.defaultRole = defaultRole;

	return room;
};

const kick = async (room: Room, by: Peer, target: Peer) => createModeratorMiddleware({ room })({
	peer: by,
	response: {},
	message: { method: 'moderator:kickPeer', data: { peerId: target.id } },
} as unknown as PeerContext, jest.fn());

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
});

const BASE = [ Permission.SEND_CHAT, Permission.SHARE_AUDIO ];
const WITH_MODERATION = [ ...BASE, Permission.MODERATE_ROOM ];

describe('a permission removed from the default role of a live room', () => {
	test('is taken from a guest in a managed room at once: its kick is refused', async () => {
		const room = makeRoom(true, role(5, ...WITH_MODERATION));
		const guest = makePeer(WITH_MODERATION);
		const other = makePeer(WITH_MODERATION);

		room.joinPeer(guest);
		room.joinPeer(other);

		changeDefaultRolePermission(room, { roleId: '5', permission: { id: 3, name: Permission.MODERATE_ROOM } } as unknown as ManagedRolePermission, false);

		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(guest.notify).toHaveBeenCalledWith({ method: 'permissionRemoved', data: { permission: Permission.MODERATE_ROOM } });
		await expect(kick(room, guest, other)).rejects.toThrow('peer not authorized');
		expect(other.closed).toBe(false);

		// Later recomputations do not bring it back.
		changeDefaultRolePermission(room, { roleId: '5', permission: { id: 9, name: Permission.SHARE_VIDEO } } as unknown as ManagedRolePermission, true);
		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(guest.hasPermission(Permission.SHARE_VIDEO)).toBe(true);
	});

	test('is taken from the guests of an unmanaged room, whose moderator stays one', () => {
		const room = makeRoom(false, role(5, ...WITH_MODERATION));
		const moderator = makePeer(allPermissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK));
		const guest = makePeer(WITH_MODERATION);

		room.joinPeer(moderator);
		room.joinPeer(guest);

		applyDefaultRole(room, role(5, ...BASE));

		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(moderator.hasPermission(Permission.MODERATE_ROOM)).toBe(true);
	});

	test('is taken from peers waiting in the lobby too', () => {
		const room = makeRoom(true, role(5, ...WITH_MODERATION));
		const waiting = makePeer(WITH_MODERATION);

		room.lobbyPeers.add(waiting);
		applyDefaultRole(room, role(5, ...BASE));

		expect(waiting.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
	});

	test('a role of another id is left alone', () => {
		const room = makeRoom(true, role(5, ...WITH_MODERATION));

		changeDefaultRolePermission(room, { roleId: '6', permission: { id: 3, name: Permission.MODERATE_ROOM } } as unknown as ManagedRolePermission, false);

		expect([ ...(room.defaultRole?.permissions ?? []) ].map((p) => p.name)).toContain(Permission.MODERATE_ROOM);
	});
});

describe('the default role of a live room', () => {
	test('replaced by another role applies to every peer', () => {
		const room = makeRoom(true, role(5, ...WITH_MODERATION));
		const guest = makePeer(WITH_MODERATION);

		room.joinPeer(guest);
		applyDefaultRole(room, role(6, Permission.SEND_CHAT));

		expect(guest.permissions.sort()).toEqual([ Permission.SEND_CHAT ]);
	});

	test('deleted takes its permissions away', () => {
		const room = makeRoom(false, role(5, ...WITH_MODERATION));
		const moderator = makePeer(allPermissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK));
		const guest = makePeer(WITH_MODERATION);

		room.joinPeer(moderator);
		room.joinPeer(guest);
		removeRole(room, role(5));

		expect(room.defaultRole).toBeUndefined();
		expect(guest.permissions).toEqual([]);
		expect(moderator.hasPermission(Permission.MODERATE_ROOM)).toBe(true);
	});

	test('unchanged (any room patch carries it) keeps what a moderator granted in the room', () => {
		const room = makeRoom(true, role(5, ...BASE));
		const guest = makePeer(BASE);

		room.joinPeer(guest);
		guest.permissions = [ ...BASE, Permission.SHARE_SCREEN ];

		applyDefaultRole(room, role(5, ...[ ...BASE ].reverse()));

		expect(guest.hasPermission(Permission.SHARE_SCREEN)).toBe(true);
	});
});

describe('management events', () => {
	test('a room patch with its own default role applies it; one without switches to the tenant default', async () => {
		const room = makeRoom(true, role(5, ...WITH_MODERATION));
		const guest = makePeer(WITH_MODERATION);
		const tenantDefault = jest.fn(async () => role(9, Permission.SEND_CHAT));

		room.joinPeer(guest);

		await updateRoomDefaultRole(room, { defaultRole: role(5, ...BASE) } as unknown as ManagedRoom, tenantDefault);
		expect(guest.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
		expect(room.defaultRoleFromTenant).toBe(false);
		expect(tenantDefault).not.toHaveBeenCalled();

		await updateRoomDefaultRole(room, {} as ManagedRoom, tenantDefault);
		expect(tenantDefault).toHaveBeenCalledWith(1);
		expect(room.defaultRoleFromTenant).toBe(true);
		expect(guest.permissions).toEqual([ Permission.SEND_CHAT ]);

		// Further patches without a room default do not fetch again.
		await updateRoomDefaultRole(room, {} as ManagedRoom, tenantDefault);
		expect(tenantDefault).toHaveBeenCalledTimes(1);
	});

	test('a tenant default change reaches the rooms of that tenant that use it, and only those', () => {
		const usesTenant = makeRoom(false, role(9, ...WITH_MODERATION));
		const ownRole = makeRoom(true, role(5, ...WITH_MODERATION));
		const otherTenant = new Room({ id: 'o', tenantId: 2, mediaService: {} as unknown as MediaService });

		usesTenant.defaultRoleFromTenant = true;
		otherTenant.defaultRole = role(9, ...WITH_MODERATION);
		otherTenant.defaultRoleFromTenant = true;

		applyTenantDefaultRole([ usesTenant, ownRole, otherTenant ], { tenantId: 1, defaultRole: role(9, ...BASE) });

		const names = (r: Room) => (r.defaultRole?.permissions ?? []).map((p) => p.name);

		expect(names(usesTenant)).not.toContain(Permission.MODERATE_ROOM);
		expect(names(ownRole)).toContain(Permission.MODERATE_ROOM);
		expect(names(otherTenant)).toContain(Permission.MODERATE_ROOM);
	});
});
