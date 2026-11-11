import { Peer } from '../Peer';
import Room from '../Room';
import { ManagedGroup, ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoom, ManagedRoomOwner, ManagedUserRole, MediaSourceType, RoomSettings } from './types';
import { Logger } from 'edumeet-common';
import { botProfile } from './botProfile';

const logger = new Logger('authorization');

/* eslint-disable no-unused-vars */
export enum Permission {
	// The role(s) will gain access to the room even if it is locked (!)
	BYPASS_ROOM_LOCK = 'BYPASS_ROOM_LOCK',
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
	SHARE_EXTRA_VIDEO = 'SHARE_EXTRA_VIDEO',
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
	// The role(s) have permission to join/leave rooms
	CHANGE_ROOM = 'CHANGE_ROOM',
}

export const allPermissions = Object.values(Permission);

export const isAllowed = (room: Room, peer: Peer) => {
	if (room.locked && !peer.hasPermission(Permission.BYPASS_ROOM_LOCK))
		return false;

	return true;
};

export const permittedProducer = (source: MediaSourceType, room: Room, peer: Peer) => {
	if (!source || !Object.values(MediaSourceType).includes(source))
		throw new Error('invalid producer source');

	if ((source === MediaSourceType.MIC || source === MediaSourceType.SCREENAUDIO) && !peer.hasPermission(Permission.SHARE_AUDIO))
		throw new Error('peer not authorized');

	if (source === MediaSourceType.WEBCAM && !peer.hasPermission(Permission.SHARE_VIDEO))
		throw new Error('peer not authorized');

	if (source === MediaSourceType.SCREEN && !peer.hasPermission(Permission.SHARE_SCREEN))
		throw new Error('peer not authorized');

	if (source === MediaSourceType.EXTRAVIDEO && !peer.hasPermission(Permission.SHARE_EXTRA_VIDEO))
		throw new Error('peer not authorized');

	if (source === MediaSourceType.EXTRAAUDIO && !peer.hasPermission(Permission.SHARE_EXTRA_VIDEO))
		throw new Error('peer not authorized');
};

// The moderator of an unmanaged room gets every permission except BYPASS_ROOM_LOCK, which only a
// signed-in peer gets, as a tenant admin could have disabled unmanaged rooms
const unmanagedModeratorPermissions = (peer: Peer): Permission[] => (peer.managedId
	? allPermissions
	: allPermissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK));

// An unmanaged room has no owner, so its first participant is its moderator. When the last
// moderator leaves, the participant who has been in the room longest becomes moderator instead,
// so a room is never left without one: the default role gives the others no moderation rights.
// Whoever holds MODERATE_ROOM counts as a moderator, also one granted it during the meeting.
// A peer still joining counts too, as it may be the first participant, made moderator when it
// arrived; joinPeer() runs this again when it is in, in case the last moderator left meanwhile.
export const ensureUnmanagedModerator = (room: Room): void => {
	if (room.closed || room.managedId) return;

	const isModerator = (p: Peer) => !p.headless && p.hasPermission(Permission.MODERATE_ROOM);

	if ([ ...room.pendingPeers.items, ...room.peers.items ].some(isModerator)) return;

	const next = room.participants[0];

	if (!next) return;

	logger.debug({ peerId: next.id }, 'ensureUnmanagedModerator() no moderator left, passing moderation on');

	const hadPromotePermission = next.hasPermission(Permission.PROMOTE_PEER);
	const permissions = [ ...new Set([ ...next.permissions, ...unmanagedModeratorPermissions(next) ]) ];

	next.permissions = room.disableUnmanaged
		? permissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK)
		: permissions;

	// The new moderator is now the one to let in those who wait in the lobby
	if (!hadPromotePermission)
		next.notify({ method: 'parkedPeers', data: { lobbyPeers: room.lobbyPeers.items.map((p) => (p.peerInfo)) } });

	// Tells everyone, the new moderator included, that moderation was passed on and to whom
	room.notifyPeers('moderatorHandover', { peerId: next.id });
};

// What a peer waiting in the lobby of an unmanaged room holds: the default role, nothing of a
// moderator's. Who comes first to a locked room with nobody in it is not its moderator, and the
// rights would otherwise go in with it when someone lets it in.
export const lobbyPermissions = (room: Room): string[] => {
	const permissions = room.defaultRole?.permissions.map((p) => p.name) ?? [];

	return room.disableUnmanaged ? permissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK) : permissions;
};

export const updatePeerPermissions = (room: Room, peer: Peer, inLobby = false, isReconnect = false): void => {
	if (peer.headless) {
		peer.permissions = [ ...(peer.botVerified ? botProfile.verifiedPermissions : botProfile.permissions) ];

		return;
	}

	const hadPromotePermission = peer.hasPermission(Permission.PROMOTE_PEER);
	const defaultPermissions = room.defaultRole?.permissions.map((p) => p.name) ?? [];
	let shouldPromote = false;
	let shouldGiveLobbyPeers = false;

	if (room.managedId) { // managed rooms
		logger.debug({ roomManagedId: room.managedId }, 'Is managed room');

		if (room.owners.find((o) => o.userId === peer.managedId)) { // Owner gets everything
			peer.permissions = allPermissions;

			shouldPromote = inLobby;
			shouldGiveLobbyPeers = !hadPromotePermission;
		} else {
			let currentPermissions = peer.permissions;

			if (!isReconnect)
				currentPermissions = [];

			// Find the user roles the peer has, and get the roles for those user roles
			const userPermissions = room.userRoles
				.filter((ur) => ur.userId === peer.managedId)
				.map((ur) => ur.role.permissions.map((p) => p.name))
				.flat();
			// Find the groups the peer is in, and get the roles for those groups
			const groupPermissions = room.groupRoles
				.filter((gr) => peer.groupIds.includes(gr.groupId))
				.map((gr) => gr.role.permissions.map((p) => p.name))
				.flat();

			// Combine and remove duplicates
			peer.permissions = [ ...new Set([ ...currentPermissions, ...userPermissions, ...groupPermissions, ...defaultPermissions ]) ];

			shouldPromote = inLobby && peer.hasPermission(Permission.BYPASS_ROOM_LOCK);
			shouldGiveLobbyPeers = !hadPromotePermission && peer.hasPermission(Permission.PROMOTE_PEER);
		}
	} else if (room.participants.length === 0) { // unmanaged rooms - fake admin
		logger.debug('Is unmanaged room - first peer');

		// Combine and remove duplicates.
		// We combine as in default permissions BYPASS_ROOM_LOCK might be added
		peer.permissions = [ ...new Set([ ...unmanagedModeratorPermissions(peer), ...defaultPermissions ]) ];

		// Ensure disableUnmanaged can't be bypassed via a defaultRole that includes BYPASS_ROOM_LOCK
		if (room.disableUnmanaged)
			peer.permissions = peer.permissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK);

		shouldPromote = inLobby && peer.hasPermission(Permission.BYPASS_ROOM_LOCK);
		shouldGiveLobbyPeers = !hadPromotePermission && peer.hasPermission(Permission.PROMOTE_PEER);
	} else { // unmanaged rooms - default
		logger.debug('Is unmanaged room - further peer');
	
		// Combine defaultPermissions with current permissions
		// We combine as user might logged in while in room, so if he is unmanaged admin from if above, he has to keep the permissions
		peer.permissions = [ ...new Set([ ...peer.permissions, ...defaultPermissions ]) ];

		// Ensure disableUnmanaged can't be bypassed via a defaultRole that includes BYPASS_ROOM_LOCK
		if (room.disableUnmanaged)
			peer.permissions = peer.permissions.filter((p) => p !== Permission.BYPASS_ROOM_LOCK);

		shouldPromote = inLobby && peer.hasPermission(Permission.BYPASS_ROOM_LOCK);
		shouldGiveLobbyPeers = !hadPromotePermission && peer.hasPermission(Permission.PROMOTE_PEER);
	}

	// A peer in the lobby of an unmanaged room that cannot pass the lock stays there: with the
	// default role only.
	if (!room.managedId && inLobby && !peer.hasPermission(Permission.BYPASS_ROOM_LOCK)) {
		peer.permissions = lobbyPermissions(room);
		shouldGiveLobbyPeers = false;
	}

	logger.debug({ peerPermissions: peer.permissions }, 'Final peer permissions');

	if (shouldPromote) return room.promotePeer(peer); // We return here because the peer will get the lobbyPeers when it joins

	// Only a peer that is in the room can keep a lobby list current: promotions and departures in the
	// lobby are announced to room peers alone. A peer that is about to be parked, or waits in the
	// lobby, would carry a list of the people waiting beside it into the room and never hear that
	// they were let in. It gets the list from its join response instead.
	if (shouldGiveLobbyPeers && room.peers.items.includes(peer))
		peer.notify({ method: 'parkedPeers', data: { lobbyPeers: room.lobbyPeers.items.map((p) => (p.peerInfo)) } });
};

export const updateRoom = (room: Room, managedRoom: ManagedRoom): void => {
	const meetingsOnly = Boolean(managedRoom.meetingsOnly);

	if (room.meetingsOnly && !meetingsOnly) room.activeMeetingToken = undefined;
	room.meetingsOnly = meetingsOnly;
	room.locked = managedRoom.locked;
	room.chatEnabled = managedRoom.chatEnabled;
	room.filesharingEnabled = managedRoom.filesharingEnabled;
	room.raiseHandEnabled = managedRoom.raiseHandEnabled;
	room.reactionsEnabled = managedRoom.reactionsEnabled;
	room.localRecordingEnabled = managedRoom.localRecordingEnabled;
	room.breakoutsEnabled = managedRoom.breakoutsEnabled;
	room.maxActiveVideos = managedRoom.maxActiveVideos;

	// TODO: handle defaultRole changing

	const managedSettings: RoomSettings = {
		logo: managedRoom.logo,
		background: managedRoom.background,

		// Video settings
		videoCodec: managedRoom.videoCodec,
		simulcast: managedRoom.simulcast,
		videoResolution: managedRoom.videoResolution,
		videoFramerate: managedRoom.videoFramerate,

		// Audio settings
		audioCodec: managedRoom.audioCodec,
		autoGainControl: managedRoom.autoGainControl,
		echoCancellation: managedRoom.echoCancellation,
		noiseSuppression: managedRoom.noiseSuppression,
		sampleRate: managedRoom.sampleRate,
		channelCount: managedRoom.channelCount,
		sampleSize: managedRoom.sampleSize,
		opusStereo: managedRoom.opusStereo,
		opusDtx: managedRoom.opusDtx,
		opusFec: managedRoom.opusFec,
		opusPtime: managedRoom.opusPtime,
		opusMaxPlaybackRate: managedRoom.opusMaxPlaybackRate,

		// Screen sharing settings
		screenSharingCodec: managedRoom.screenSharingCodec,
		screenSharingSimulcast: managedRoom.screenSharingSimulcast,
		screenSharingResolution: managedRoom.screenSharingResolution,
		screenSharingFramerate: managedRoom.screenSharingFramerate
	};

	room.settings = managedSettings;

	room.notifyPeers('roomUpdate', {
		name: room.name,
		locked: room.locked,
		meetingsOnly: room.meetingsOnly,
		chatEnabled: room.chatEnabled,
		filesharingEnabled: room.filesharingEnabled,
		raiseHandEnabled: room.raiseHandEnabled,
		localRecordingEnabled: room.localRecordingEnabled,
		breakoutsEnabled: room.breakoutsEnabled,
		maxActiveVideos: room.maxActiveVideos,

		settings: room.settings
	});
};

export const addRoomOwner = (room: Room, roomOwner: ManagedRoomOwner): void => {
	room.owners.push(roomOwner);

	// Check if the peer is already in the room, if so, notify it
	const peer = room.getPeerByManagedId(roomOwner.userId);

	if (peer) updatePeerPermissions(room, peer);
};

export const removeRoomOwner = (room: Room, roomOwner: ManagedRoomOwner): void => {
	room.permissionsRevision++;

	room.owners = room.owners.filter((o) => o.id !== roomOwner.id);

	// Check if the peer is already in the room, if so, notify it
	const peer = room.getPeerByManagedId(roomOwner.userId);

	if (peer) updatePeerPermissions(room, peer);
};

export const addRoomUserRole = (room: Room, roomUserRole: ManagedUserRole): void => {
	room.userRoles.push(roomUserRole);

	// Check if the peer is already in the room, if so, notify it
	const peer = room.getPeerByManagedId(roomUserRole.userId);

	if (peer) updatePeerPermissions(room, peer);
};

export const removeRoomUserRole = (room: Room, roomUserRole: ManagedUserRole): void => {
	room.permissionsRevision++;

	room.userRoles = room.userRoles.filter((ur) => ur.id !== roomUserRole.id);

	// Check if the peer is already in the room, if so, notify it
	const peer = room.getPeerByManagedId(roomUserRole.userId);

	if (peer) updatePeerPermissions(room, peer);
};

export const addRoomGroupRole = (room: Room, roomGroupRole: ManagedGroupRole): void => {
	room.groupRoles.push(roomGroupRole);

	// Check if the peer is already in the room, if so, notify it
	const peers = room.getPeersByGroupId(roomGroupRole.groupId);

	peers.forEach((peer) => updatePeerPermissions(room, peer));
};

export const removeRoomGroupRole = (room: Room, roomGroupRole: ManagedGroupRole): void => {
	room.permissionsRevision++;

	room.groupRoles = room.groupRoles.filter((gr) => gr.id !== roomGroupRole.id);

	// Check if the peer is already in the room, if so, notify it
	const peers = room.getPeersByGroupId(roomGroupRole.groupId);

	peers.forEach((peer) => updatePeerPermissions(room, peer));
};

export const removeGroup = (room: Room, group: ManagedGroup): void => {
	room.permissionsRevision++;

	room.groupRoles = room.groupRoles.filter((gr) => gr.groupId !== String(group.id));

	// Check if the peer is already in the room, if so, notify it
	const peers = room.getPeersByGroupId(String(group.id));

	for (const peer of peers) {
		peer.groupIds = peer.groupIds.filter((id) => id !== String(group.id));

		updatePeerPermissions(room, peer);
	}
};

export const addGroupUser = (room: Room, groupUser: ManagedGroupUser): void => {
	// Check if the peer is already in the room, if so, notify it
	const peer = room.getPeerByManagedId(groupUser.userId);

	if (peer) {
		const groupRole = room.groupRoles.find((gr) => gr.groupId === groupUser.groupId);

		if (groupRole) {
			peer.groupIds.push(groupUser.groupId);
			updatePeerPermissions(room, peer);
		}
	}
};

export const removeGroupUser = (room: Room, groupUser: ManagedGroupUser): void => {
	room.permissionsRevision++;

	// Check if the peer is already in the room, if so, notify it
	const peer = room.getPeerByManagedId(groupUser.userId);

	if (peer) {
		const groupRole = room.groupRoles.find((gr) => gr.groupId === groupUser.groupId);

		if (groupRole) {
			peer.groupIds = peer.groupIds.filter((id) => id !== groupUser.groupId);
			updatePeerPermissions(room, peer);
		}
	}
};

export const removeRole = (room: Room, role: ManagedRole): void => {
	room.permissionsRevision++;

	room.userRoles.forEach((ur) => {
		if (ur.roleId === String(role.id))
			removeRoomUserRole(room, ur);
	});

	room.groupRoles.forEach((gr) => {
		if (gr.roleId === String(role.id))
			removeRoomGroupRole(room, gr);
	});

	const defaultRole = room.defaultRole as ManagedRole;

	if (defaultRole?.id === role.id) {
		room.defaultRole = undefined;

		const peers = room.getPeers();

		peers.forEach((peer) => updatePeerPermissions(room, peer));
	}
};

export const addRolePermission = (room: Room, rolePermission: ManagedRolePermission): void => {
	room.userRoles.forEach((ur) => {
		if (ur.roleId === rolePermission.roleId) {
			ur.role.permissions.push(rolePermission.permission);

			const peer = room.getPeerByManagedId(ur.userId);

			if (peer) updatePeerPermissions(room, peer);
		}
	});

	room.groupRoles.forEach((gr) => {
		if (gr.roleId === rolePermission.roleId) {
			gr.role.permissions.push(rolePermission.permission);

			const peers = room.getPeersByGroupId(gr.groupId);

			peers.forEach((peer) => updatePeerPermissions(room, peer));
		}
	});
};

export const removeRolePermission = (room: Room, rolePermission: ManagedRolePermission): void => {
	room.permissionsRevision++;

	room.userRoles.forEach((ur) => {
		if (ur.roleId === rolePermission.roleId) {
			ur.role.permissions = ur.role.permissions.filter((p) => p.id !== rolePermission.permission.id);

			const peer = room.getPeerByManagedId(ur.userId);

			if (peer) updatePeerPermissions(room, peer);
		}
	});

	room.groupRoles.forEach((gr) => {
		if (gr.roleId === rolePermission.roleId) {
			gr.role.permissions = gr.role.permissions.filter((p) => p.id !== rolePermission.permission.id);

			const peers = room.getPeersByGroupId(gr.groupId);

			peers.forEach((peer) => updatePeerPermissions(room, peer));
		}
	});
};
