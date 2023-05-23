import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

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

	// Look and feel
	logo?: string;
	background?: string;

	// Features of the room
	maxActiveVideos: number;
	locked: boolean;
	breakoutsEnabled: boolean;
	chatEnabled: boolean;
	raiseHandEnabled: boolean;
	filesharingEnabled: boolean;
	localRecordingEnabled: boolean;
};

export type ManagedUser = {
	id: number;
	tenantId: number;
	email: string;
	name?: string;
	avatar?: string;
};

export type ManagedUserRole = {
	id: number;
	roomId: number;
	userId: number;
	roleId: number;
	role: ManagedRole;
}

export type ManagedGroupRole = {
	id: number;
	roomId: number;
	groupId: number;
	roleId: number;
	role: ManagedRole;
}

export type ManagedRoomOwner = {
	id: number;
	roomId: number;
	userId: number;
}

export type ManagedRole = {
	id: number;
	name: string;
	description?: string;
	permissions: ManagedPermission[];
	tenantId: number;
}

export type ManagedPermission = {
	id: number;
	name: string;
	description?: string;
}

export type ManagedRolePermission = {
	id: number;
	roleId: number;
	permissionId: number;
	permission: ManagedPermission;
}

export type ManagedGroup = {
	id: number;
	name: string;
	description: string;
	tenantId?: number;
}

export type ManagedGroupUser = {
	id: number;
	groupId: number;
	userId: number;
}