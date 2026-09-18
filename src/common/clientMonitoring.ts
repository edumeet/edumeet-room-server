import { ClientMonitoringConfig } from '../Config';

interface MonitoredRoom {
	id: string;
	sessionId: string;
	tenantFqdn?: string;
}

export interface MonitoringRoomInfo {
	tenantFqdn?: string;
	roomLabel?: string;
}

/**
 * What a media node is told about a room so that it can file the client
 * monitoring samples it collects. Nothing unless the operator asks for it: by
 * default a node knows a room only by its random session id. The label is the
 * room name, or that session id again when room names are to stay off the nodes.
 */
export const roomInfoForMonitoring = (room: MonitoredRoom, settings?: ClientMonitoringConfig): MonitoringRoomInfo => {
	if (!settings?.roomInfo) return {};

	return {
		// Without the trailing dot, as the tenant lookup reads it, so both spellings of a host file
		// together. Not lowercased: the lookup is exact, and a host it did not match must not be
		// relabelled into the folder of the tenant it resembles.
		tenantFqdn: room.tenantFqdn?.replace(/\.$/, ''),
		roomLabel: settings.obfuscateRoomName ? room.sessionId : room.id,
	};
};
