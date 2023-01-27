import { Peer } from '../Peer';
import Room from '../Room';
import { Role } from './types';
import { MediaSourceType } from 'edumeet-common';
type MediaSourceType = typeof MediaSourceType[keyof typeof MediaSourceType];

export const userRoles: Record<string, Role> = {
	// These can be changed, id must be unique.

	// A person can give other peers any role that is promotable: true
	// with a level up to and including their own highest role.
	// Example: A MODERATOR can give other peers PRESENTER and MODERATOR
	// roles (all peers always have NORMAL)
	ADMIN: { id: 2529, label: 'admin', level: 50, promotable: true },
	MODERATOR: { id: 5337, label: 'moderator', level: 40, promotable: true },
	PRESENTER: { id: 9583, label: 'presenter', level: 30, promotable: true },
	AUTHENTICATED: { id: 5714, label: 'authenticated', level: 20, promotable: false },
	// Don't change anything after this point

	// All users have this role by default, do not change or remove this role
	NORMAL: { id: 4261, label: 'normal', level: 10, promotable: false }
};

/* eslint-disable no-unused-vars, no-shadow */
export enum Permission {
	// The role(s) have permission to lock/unlock a room
	CHANGE_ROOM_LOCK = 'CHANGE_ROOM_LOCK',
	// The role(s) have permission to promote a peer from the lobby
	PROMOTE_PEER = 'PROMOTE_PEER',
	// The role(s) have permission to give/remove other peers roles
	MODIFY_ROLE = 'MODIFY_ROLE',
	// The role(s) have permission to send chat messages
	SEND_CHAT = 'SEND_CHAT',
	// The role(s) have permission to moderate chat
	MODERATE_CHAT = 'MODERATE_CHAT',
	// The role(s) have permission to share audio
	SHARE_AUDIO = 'SHARE_AUDIO',
	// The role(s) have permission to share video
	SHARE_VIDEO = 'SHARE_VIDEO',
	// The role(s) have permission to share screen
	SHARE_SCREEN = 'SHARE_SCREEN',
	// The role(s) have permission to produce extra video
	EXTRA_VIDEO = 'EXTRA_VIDEO',
	// The role(s) have permission to share files
	SHARE_FILE = 'SHARE_FILE',
	// The role(s) have permission to moderate files
	MODERATE_FILES = 'MODERATE_FILES',
	// The role(s) have permission to moderate room (e.g. kick user)
	MODERATE_ROOM = 'MODERATE_ROOM',
	// The role(s) have permission to local record room
	LOCAL_RECORD_ROOM = 'LOCAL_RECORD_ROOM',
	// The role(s) have permission to create rooms
	CREATE_ROOM = 'CREATE_ROOM',
}

export enum Access {
	// The role(s) will gain access to the room
	// even if it is locked (!)
	BYPASS_ROOM_LOCK = 'BYPASS_ROOM_LOCK',

	// The role(s) will gain access to the room without
	// going into the lobby. If you want to restrict access to your
	// server to only directly allow authenticated users, you could
	// add the userRoles.AUTHENTICATED to the user in the userMapping
	// function, and change to BYPASS_LOBBY : [ userRoles.AUTHENTICATED ]
	BYPASS_LOBBY = 'BYPASS_LOBBY',
}

export const roomAccess = {
	[Access.BYPASS_ROOM_LOCK]: [ userRoles.ADMIN ],
	[Access.BYPASS_LOBBY]: [ userRoles.NORMAL ],
};

export const roomPermissions = {
	[Permission.CHANGE_ROOM_LOCK]: [ userRoles.NORMAL ],
	[Permission.PROMOTE_PEER]: [ userRoles.NORMAL ],
	[Permission.MODIFY_ROLE]: [ userRoles.NORMAL ],
	[Permission.SEND_CHAT]: [ userRoles.NORMAL ],
	[Permission.MODERATE_CHAT]: [ userRoles.NORMAL ],
	[Permission.SHARE_AUDIO]: [ userRoles.NORMAL ],
	[Permission.SHARE_VIDEO]: [ userRoles.NORMAL ],
	[Permission.SHARE_SCREEN]: [ userRoles.NORMAL ],
	[Permission.EXTRA_VIDEO]: [ userRoles.NORMAL ],
	[Permission.SHARE_FILE]: [ userRoles.NORMAL ],
	[Permission.MODERATE_FILES]: [ userRoles.NORMAL ],
	[Permission.MODERATE_ROOM]: [ userRoles.NORMAL ],
	[Permission.LOCAL_RECORD_ROOM]: [ userRoles.NORMAL ],
	[Permission.CREATE_ROOM]: [ userRoles.NORMAL ],
};

export const allowWhenRoleMissing: Permission[] = [];
export const activateOnHostJoin = false;
/* eslint-enable no-unused-vars, no-shadow */

export const hasPermission = (
	room: Room,
	peer: Peer,
	permission: Permission
): boolean => {
	const exists = peer.roles.some((role) =>
		roomPermissions[permission].some((roomRole) => role.id === roomRole.id)
	);

	if (exists)
		return true;

	if (
		allowWhenRoleMissing.includes(permission) &&
		permittedPeers(room, permission).length === 0
	)
		return true;

	return false;
};

export const hasAccess = (peer: Peer, access: Access): boolean => {
	return peer.roles.some((role) =>
		roomAccess[access].some((roomRole) => role.id === roomRole.id)
	);
};

export const isAllowed = (room: Room, peer: Peer): boolean => {
	return hasAccess(peer, Access.BYPASS_ROOM_LOCK) ||
		(!room.locked && hasAccess(peer, Access.BYPASS_LOBBY));
};

export const isAllowedBecauseMissing = (
	room: Room,
	peer: Peer,
	permission: Permission
) => {
	return !room.lobbyPeers.empty &&
		hasPermission(room, peer, permission) &&
		permittedPeers(room, permission).length === 0;
};

export const promoteOnHostJoin = (room: Room, peer: Peer): boolean => {
	return activateOnHostJoin && !room.lobbyPeers.empty && !room.locked &&
		hasPermission(room, peer, Permission.PROMOTE_PEER);
};

export const allowedPeers = (
	room: Room,
	permission: Permission,
	excludePeer?: Peer
): Peer[] => {
	const peers = permittedPeers(room, permission, excludePeer, false);

	if (peers.length > 0)
		return peers;
	else if (allowWhenRoleMissing.includes(permission))
		return room.getPeers(excludePeer);

	return [];
};

export const permittedPeers = (
	room: Room,
	permission: Permission,
	excludePeer?: Peer,
	pending = true,
): Peer[] => {
	const peers = [ ...room.peers.items ];

	if (pending)
		peers.push(...room.pendingPeers.items);

	return peers.filter(
		(p) =>
			p !== excludePeer &&
			p.roles.some(
				(role) =>
					roomPermissions[permission].some((roomRole) =>
						role.id === roomRole.id)
			)
	);
};

export const permittedProducer = (source: MediaSourceType, room: Room, peer: Peer) => {
	if (
		!source ||
		!Object.values(MediaSourceType)
			.includes(source)
	)
		throw new Error('invalid producer source');

	if (
		(source === MediaSourceType.MIC || source === MediaSourceType.SCREENAUDIO) &&
		!hasPermission(room, peer, Permission.SHARE_AUDIO)
	)
		throw new Error('peer not authorized');

	if (
		source === MediaSourceType.WEBCAM &&
		!hasPermission(room, peer, Permission.SHARE_VIDEO)
	)
		throw new Error('peer not authorized');

	if (
		source === MediaSourceType.SCREEN &&
		!hasPermission(room, peer, Permission.SHARE_SCREEN)
	)
		throw new Error('peer not authorized');

	if (
		source === MediaSourceType.EXTRAVIDEO &&
		!hasPermission(room, peer, Permission.EXTRA_VIDEO)
	)
		throw new Error('peer not authorized');
};