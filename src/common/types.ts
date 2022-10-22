import MediaService from '../MediaService';
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
	room: Room;
	mediaService: MediaService;
	chatHistory: ChatMessage[];
	fileHistory: FileMessage[];
}

export interface Role {
	id: number;
	label: string;
	level: number;
	promotable: boolean;
}