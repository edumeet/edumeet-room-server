import { ManagedRole } from './common/types';

export interface Config {
	listenHost: string;
	listenPort: string;
	tls?: {
		cert: string;
		key: string;
	};
	managementService?: {
		host: string;
		jwtPublicKeys: Array<string>;
	};
	defaultRoomSettings?: {
		defaultRole?: ManagedRole;
		locked?: boolean;
		maxActiveVideos?: number;
		breakoutsEnabled?: boolean;
		chatEnabled?: boolean;
		filesharingEnabled?: boolean;
		raiseHandEnabled?: boolean;
		localRecordingEnabled?: boolean;
	};
	mediaNodes: Array<{
		hostname: string;
		port: number;
		secret: string;
		latitude: number;
		longitude: number;
	}>;
}