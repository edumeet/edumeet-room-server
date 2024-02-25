import { MediaNodeConfig } from './MediaService';
import { RoomRole } from './common/types';
import fs from 'fs';

let config: Config;

export function getConfig(): Config {
	if (!config) {
		try {
			const rawConfig = fs.readFileSync('./config/config.json', 'utf8');

			config = JSON.parse(rawConfig);
		} catch (e) {
			config = {
				listenHost: '0.0.0.0',
				listenPort: '8443',
				defaultRoomSettings: {
					defaultRole: {
						name: 'Default',
						description: 'Default role',
						permissions: [
							{ name: 'CHANGE_ROOM_LOCK' },
							{ name: 'PROMOTE_PEER' },
							{ name: 'SEND_CHAT' },
							{ name: 'MODERATE_CHAT' },
							{ name: 'SHARE_AUDIO' },
							{ name: 'SHARE_VIDEO' },
							{ name: 'SHARE_SCREEN' },
							{ name: 'SHARE_EXTRA_VIDEO' },
							{ name: 'SHARE_FILE' },
							{ name: 'MODERATE_FILES' },
							{ name: 'MODERATE_ROOM' },
							{ name: 'LOCAL_RECORD_ROOM' },
							{ name: 'CREATE_ROOM' },
							{ name: 'CHANGE_ROOM' }
						]
					}
				}
			};
		}
	}

	return config;
}

export interface Config {
	listenHost: string;
	listenPort: string;
	tls?: {
		cert: string;
		key: string;
	};
	managementService?: {
		host: string;
		jwtPublicKeys: string[];
	};
	defaultRoomSettings?: {
		defaultRole?: RoomRole;
		locked?: boolean;
		maxActiveVideos?: number;
		breakoutsEnabled?: boolean;
		chatEnabled?: boolean;
		filesharingEnabled?: boolean;
		raiseHandEnabled?: boolean;
		localRecordingEnabled?: boolean;
	};
	mediaNodes?: MediaNodeConfig[];
}
