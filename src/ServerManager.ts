import { BaseConnection, Logger, skipIfClosed } from 'edumeet-common';
import { verifyPeer } from './common/token';
import MediaService from './MediaService';
import { Peer } from './Peer';
import Room from './Room';
import ManagementService from './ManagementService';
import { RoomSettings } from './common/types';
import { getConfig } from './Config';

const logger = new Logger('ServerManager');
const config = getConfig();

interface ServerManagerOptions {
	mediaService: MediaService;
	peers: Map<string, Peer>;
	rooms: Map<string, Room>;
	managedPeers: Map<string, Peer>;
	managedRooms: Map<string, Room>;
	managementService?: ManagementService;
}

export default class ServerManager {
	public closed = false;
	public peers: Map<string, Peer>;
	public rooms: Map<string, Room>;
	public managedRooms: Map<string, Room>; // Mapped by ID from management service
	public managedPeers: Map<string, Peer>; // Mapped by ID from management service
	public mediaService: MediaService;
	public managementService?: ManagementService;

	constructor({ mediaService, peers, rooms, managedPeers, managedRooms, managementService }: ServerManagerOptions) {
		logger.debug('constructor()');

		this.mediaService = mediaService;
		this.peers = peers;
		this.rooms = rooms;
		this.managedPeers = managedPeers;
		this.managedRooms = managedRooms;
		this.managementService = managementService;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaService.close();
		this.peers.forEach((p) => p.close());
		this.rooms.forEach((r) => r.close());

		this.managedRooms.clear();
		this.peers.clear();
		this.rooms.clear();
	}

	@skipIfClosed
	public handleConnection(
		connection: BaseConnection,
		peerId: string,
		roomId: string,
		tenantId = 0,
		displayName?: string,
		token?: string,
	): void {
		logger.debug(
			'handleConnection() [peerId: %s, displayName: %s, roomId: %s, tenantId: %s]',
			peerId,
			displayName,
			roomId,
			tenantId
		);

		const managedId = token ? verifyPeer(token) : undefined;

		let peer = this.peers.get(peerId);

		if (peer) {
			logger.debug('handleConnection() there is already a Peer with same peerId [peerId: %s]', peerId);

			// If we already have a Peer and the new connection does not have a token
			// then we must close the new connection.
			// As long as the token is correct for the Peer, we can accept the new
			// connection and close the old one.
			if (managedId && managedId === peer.managedId)
				peer.close();
			else
				throw new Error('Invalid token');
		}

		let room = this.rooms.get(`${tenantId}/${roomId}`);

		if (!room) {
			logger.debug('handleConnection() new room [roomId: %s, tenantId: %s]', roomId, tenantId);

			room = new Room({ id: roomId, mediaService: this.mediaService });

			this.rooms.set(`${tenantId}/${roomId}`, room);

			room.once('close', () => {
				logger.debug('handleConnection() room closed [roomId: %s]', roomId);

				this.rooms.delete(`${tenantId}/${roomId}`);

				if (room?.managedId) this.managedRooms.delete(room.managedId);
			});

			if (config.defaultRoomSettings) {
				const {
					defaultRole,
					maxActiveVideos = 12,
					locked = false,
					breakoutsEnabled = true,
					chatEnabled = true,
					raiseHandEnabled = true,
					filesharingEnabled = true,
					localRecordingEnabled = true,
					tracker=undefined,
					maxFileSize = 100_000_000					
				} = config.defaultRoomSettings;
				
				room.tracker = tracker;
				if (maxFileSize)
					room.maxFileSize = maxFileSize;
				room.defaultRole = defaultRole;
				room.maxActiveVideos = maxActiveVideos;
				room.locked = locked;
				room.breakoutsEnabled = breakoutsEnabled;
				room.chatEnabled = chatEnabled;
				room.raiseHandEnabled = raiseHandEnabled;
				room.filesharingEnabled = filesharingEnabled;
				room.localRecordingEnabled = localRecordingEnabled;
			}

			(async () => {
				try {
					const managedRoom = await this.managementService?.getRoom(roomId, tenantId);

					if (room.closed) return;

					if (managedRoom) {
						logger.debug(
							'handleConnection() room is managed [roomId: %s, tenantId: %s, managedId: %s]',
							roomId,
							tenantId,
							managedRoom.id
						);

						room.managedId = String(managedRoom.id);
						room.name = managedRoom.name;
						room.description = managedRoom.description;
						room.owners = managedRoom.owners;
						room.groupRoles = managedRoom.groupRoles;
						room.userRoles = managedRoom.userRoles;
						room.defaultRole = managedRoom.defaultRole;

						room.maxActiveVideos = managedRoom.maxActiveVideos;
						room.locked = managedRoom.locked;
						if (managedRoom.maxFileSize)
							room.maxFileSize = managedRoom.maxFileSize;
						// TODO remove after it is part of mgmt service
						if (managedRoom.tracker)
							room.tracker = managedRoom.tracker;

						room.breakoutsEnabled = managedRoom.breakoutsEnabled;
						room.chatEnabled = managedRoom.chatEnabled;
						room.raiseHandEnabled = managedRoom.raiseHandEnabled;
						room.filesharingEnabled = managedRoom.filesharingEnabled;
						room.localRecordingEnabled = managedRoom.localRecordingEnabled;

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

						this.managedRooms.set(String(managedRoom.id), room);
					}

					room.resolveRoomReady();
				} catch (error) {
					logger.error(
						'handleConnection() error while getting room [roomId: %s, tenantId: %s, error: %o]',
						roomId,
						tenantId,
						error
					);

					room.rejectRoomReady(error as Error);
				}
			})();
		}

		peer = new Peer({ id: peerId, managedId, sessionId: room.sessionId, displayName, connection });

		this.peers.set(peerId, peer);

		if (managedId) this.managedPeers.set(String(managedId), peer);

		peer.once('close', () => {
			logger.debug('handleConnection() peer closed [peerId: %s]', peerId);
			this.peers.delete(peerId);

			if (peer?.managedId)
				this.managedPeers.delete(peer.managedId);
		});

		room.addPeer(peer);
	}
}
