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