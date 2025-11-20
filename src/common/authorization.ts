import { Peer } from '../Peer';
import Room from '../Room';
import { ManagedGroup, ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoom, ManagedRoomOwner, ManagedUserRole, MediaSourceType, RoomSettings } from './types';

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

export const updatePeerPermissions = (room: Room, peer: Peer, inLobby = false): void => {
	const hadPromotePermission = peer.hasPermission(Permission.PROMOTE_PEER);
	let shouldPromote = false;
	let shouldGiveLobbyPeers = false;

	if (room.owners.find((o) => o.userId === peer.managedId)) { // Owner gets everything
		peer.permissions = allPermissions;

		shouldPromote = inLobby;
		shouldGiveLobbyPeers = !hadPromotePermission;
	} else {
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
		const defaultPermissions = room.defaultRole?.permissions.map((p) => p.name) ?? [];

		// Combine and remove duplicates
		peer.permissions = [ ...new Set([ ...userPermissions, ...groupPermissions, ...defaultPermissions ]) ];

		shouldPromote = inLobby && peer.hasPermission(Permission.BYPASS_ROOM_LOCK);
		shouldGiveLobbyPeers = !hadPromotePermission && peer.hasPermission(Permission.PROMOTE_PEER);
	}

	if (shouldPromote) return room.promotePeer(peer); // We return here because the peer will get the lobbyPeers when it joins
	if (shouldGiveLobbyPeers) peer.notify({ method: 'parkedPeers', data: { lobbyPeers: room.lobbyPeers.items.map((p) => (p.peerInfo)) } });
};

export const updateRoom = (room: Room, managedRoom: ManagedRoom): void => {
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
	room.groupRoles = room.groupRoles.filter((gr) => gr.id !== roomGroupRole.id);

	// Check if the peer is already in the room, if so, notify it
	const peers = room.getPeersByGroupId(roomGroupRole.groupId);

	peers.forEach((peer) => updatePeerPermissions(room, peer));
};

export const removeGroup = (room: Room, group: ManagedGroup): void => {
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
		delete room.defaultRole;
		
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
