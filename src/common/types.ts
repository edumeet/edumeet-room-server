import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

// eslint-disable-next-line no-shadow
export enum MediaSourceType {
	// eslint-disable-next-line no-unused-vars
	MIC = 'mic',
	// eslint-disable-next-line no-unused-vars
	WEBCAM = 'webcam',
	// eslint-disable-next-line no-unused-vars
	SCREEN = 'screen',
	// eslint-disable-next-line no-unused-vars
	SCREENAUDIO = 'screenaudio',
	// eslint-disable-next-line no-unused-vars
	EXTRAVIDEO = 'extravideo',
	// eslint-disable-next-line no-unused-vars
	EXTRAAUDIO = 'extraaudio',
}

export interface ChatMessage {
	text: string;
	peerId: string;
	displayName?: string;
	timestamp: number;
}

export interface FileMessage {
	magnetURI: string;
	peerId: string;
	displayName?: string;
	timestamp: number;
}

export interface CanvasObject {
	object: object;
	objectId: string,
	status: string;
}

export interface LobbyPeerInfo {
	id: string;
	displayName?: string;
	picture?: string;
}

export interface MiddlewareOptions {
	room: Room | BreakoutRoom;
}

export interface Role {
	id: number;
	label: string;
	level: number;
	promotable: boolean;
}

export type ProducerScore = {
	ssrc: number;
	rid?: string;
	score: number;
};

export type ConsumerScore = {
	score: number;
	producerScore: number;
	producerScores: number[];
};

export type ConsumerLayers = {
	spatialLayer: number;
	temporalLayer?: number;
};

export type SrtpParameters = {
	cryptoSuite: SrtpCryptoSuite;
	keyBase64: string;
};

export type SrtpCryptoSuite =
	| 'AEAD_AES_256_GCM'
	| 'AEAD_AES_128_GCM'
	| 'AES_CM_128_HMAC_SHA1_80'
	| 'AES_CM_128_HMAC_SHA1_32';

export interface RoomSettings {
	logo?: string;
	background?: string;

	// Video settings
	videoCodec?: VideoCodec;
	simulcast?: boolean;
	videoResolution?: VideoResolution;
	videoFramerate?: number;

	// Audio settings
	audioCodec?: string;
	autoGainControl?: boolean;
	echoCancellation?: boolean;
	noiseSuppression?: boolean;
	sampleRate?: number;
	channelCount?: number;
	sampleSize?: number;
	opusStereo?: boolean;
	opusDtx?: boolean;
	opusFec?: boolean;
	opusPtime?: number;
	opusMaxPlaybackRate?: number;

	// Screen sharing settings
	screenSharingCodec?: VideoCodec;
	screenSharingSimulcast?: boolean;
	screenSharingResolution?: VideoResolution;
	screenSharingFramerate?: number;
}

export type VideoCodec = 'vp8' | 'vp9' | 'h264' | 'h265' | 'av1';
export type VideoResolution = 'low' | 'medium' | 'high' | 'veryhigh' | 'ultra';

export type ManagedRoom = {
	id: number;
	name: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	creatorId: number; // User ID of the creator
	tenantId: number;

	// Roles and permissions
	owners: ManagedRoomOwner[];
	groupRoles: ManagedGroupRole[]; // Group roles in this room
	userRoles: ManagedUserRole[]; // User roles in this room
	defaultRole?: ManagedRole; // Default role for users without a role in this room

	// Look and feel
	logo?: string;
	background?: string;

	// Features of the room
	maxActiveVideos: number;
	locked: boolean;
	tracker?: string;
	breakoutsEnabled: boolean;
	chatEnabled: boolean;
	raiseHandEnabled: boolean;
	filesharingEnabled: boolean;
	localRecordingEnabled: boolean;

	// Video settings
	videoCodec?: VideoCodec;
	simulcast?: boolean;
	videoResolution?: VideoResolution;
	videoFramerate?: number;

	// Audio settings
	audioCodec?: string;
	autoGainControl?: boolean;
	echoCancellation?: boolean;
	noiseSuppression?: boolean;
	sampleRate?: number;
	channelCount?: number;
	sampleSize?: number;
	opusStereo?: boolean;
	opusDtx?: boolean;
	opusFec?: boolean;
	opusPtime?: number;
	opusMaxPlaybackRate?: number;

	// Screen sharing settings
	screenSharingCodec?: VideoCodec;
	screenSharingSimulcast?: boolean;
	screenSharingResolution?: VideoResolution;
	screenSharingFramerate?: number;
};

export type ManagedUser = {
	id: number;
	tenantId: string;
	email: string;
	name?: string;
	avatar?: string;
};

export type ManagedUserRole = {
	id: number;
	roomId: string;
	userId: string;
	roleId: string;
	role: ManagedRole;
}

export type ManagedGroupRole = {
	id: number;
	roomId: string;
	groupId: string;
	roleId: string;
	role: ManagedRole;
}

export type ManagedRoomOwner = {
	id: number;
	roomId: string;
	userId: string;
}

export interface RoomRole {
	name: string;
	description: string;
	permissions: Permission[];
}

export interface ManagedRole extends RoomRole {
	id: number;
	permissions: ManagedPermission[];
	tenantId: string;
}

export interface Permission {
	name: string;
}

export interface ManagedPermission extends Permission {
	id: number;
	description: string;
}

export type ManagedRolePermission = {
	id: number;
	roleId: string;
	permissionId: string;
	permission: ManagedPermission;
}

export type ManagedGroup = {
	id: number;
	name: string;
	description: string;
	tenantId?: string;
}

export type ManagedGroupUser = {
	id: number;
	groupId: string;
	userId: string;
}
