import { Peer } from '../Peer';
import Room from '../Room';
import { MediaSourceType } from 'edumeet-common';

/* eslint-disable no-unused-vars, no-shadow */
export enum Permission {
	// The role(s) will gain access to the room even if it is locked (!)
	BYPASS_ROOM_LOCK = 'BYPASS_ROOM_LOCK',
	// The role(s) will gain access to the room without going into the lobby.
	BYPASS_LOBBY = 'BYPASS_LOBBY',
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
	// The role(s) have permission to join/leave rooms
	CHANGE_ROOM = 'CHANGE_ROOM',
}

export const allPermissions = Object.values(Permission);

export const isAllowed = (room: Room, peer: Peer) => {
	if (room.locked && !peer.hasPermission(Permission.BYPASS_ROOM_LOCK))
		return false;

	return true;
};

export const peersWithPermission = (room: Room, permission: Permission) => {
	return room.peers.items.filter((peer) => peer.hasPermission(permission));
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
		!peer.hasPermission(Permission.SHARE_AUDIO)
	)
		throw new Error('peer not authorized');

	if (
		source === MediaSourceType.WEBCAM &&
		!peer.hasPermission(Permission.SHARE_VIDEO)
	)
		throw new Error('peer not authorized');

	if (
		source === MediaSourceType.SCREEN &&
		!peer.hasPermission(Permission.SHARE_SCREEN)
	)
		throw new Error('peer not authorized');

	if (
		source === MediaSourceType.EXTRAVIDEO &&
		!peer.hasPermission(Permission.EXTRA_VIDEO)
	)
		throw new Error('peer not authorized');
};