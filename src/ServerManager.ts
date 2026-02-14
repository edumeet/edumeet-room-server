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
			{ peerId: peerId, displayName: displayName, roomId: roomId, tenantId: tenantId },
			'handleConnection() init params'
		);

		const managedId = token ? verifyPeer(token) : undefined;

		logger.debug(
			{ peerManagedId: managedId },
			'handleConnection() peerManagedId'
		);

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
					reactionsEnabled = true,
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
				room.reactionsEnabled = reactionsEnabled;
				room.filesharingEnabled = filesharingEnabled;
				room.localRecordingEnabled = localRecordingEnabled;
			}

			(async () => {
				try {
					const managedRoom = await this.managementService?.getRoom(roomId, tenantId);

					if (room.closed) return;

					if (managedRoom) {
						// id = 0 is the virtual "fallback" room created in ManagementService
						const isFallbackDefault = Number(managedRoom.id) === 0;

						if (!isFallbackDefault) {
							// === REAL MANAGED ROOM (from mgmt DB) ===
							logger.debug(
								'handleConnection() room is managed [roomId: %s, tenantId: %s, managedId: %s]',
								roomId,
								tenantId,
								managedRoom.id
							);

							room.managedId = String(managedRoom.id);

							// copy everything as before
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
							room.reactionsEnabled = managedRoom.reactionsEnabled;
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
						} else {
							// === FALLBACK VIRTUAL ROOM (defaults) ===
							// There is no real room in mgmt DB; only tenant/room defaults.
							// Treat this as UNMANAGED: do NOT set room.managedId or managedRooms,
							// and only override fields that are actually configured in fallback.
							logger.debug(
								'handleConnection() room has management defaults only (fallback), treating as UNMANAGED [roomId: %s, tenantId: %s]',
								roomId,
								tenantId
							);

							// Don't touch name / description / owners / roles unless present.
							if (managedRoom.defaultRole)
								room.defaultRole = managedRoom.defaultRole;

							// numbers / booleans: only override if explicitly defined
							if (typeof managedRoom.maxActiveVideos === 'number')
								room.maxActiveVideos = managedRoom.maxActiveVideos;

							if (typeof managedRoom.locked === 'boolean')
								room.locked = managedRoom.locked;

							if (managedRoom.maxFileSize)
								room.maxFileSize = managedRoom.maxFileSize;

							// TODO remove after it is part of mgmt service
							if (managedRoom.tracker)
								room.tracker = managedRoom.tracker;

							if (typeof managedRoom.breakoutsEnabled === 'boolean')
								room.breakoutsEnabled = managedRoom.breakoutsEnabled;

							if (typeof managedRoom.chatEnabled === 'boolean')
								room.chatEnabled = managedRoom.chatEnabled;

							if (typeof managedRoom.raiseHandEnabled === 'boolean')
								room.raiseHandEnabled = managedRoom.raiseHandEnabled;

							if (typeof managedRoom.reactionsEnabled === 'boolean')
								room.reactionsEnabled = managedRoom.reactionsEnabled;

							if (typeof managedRoom.filesharingEnabled === 'boolean')
								room.filesharingEnabled = managedRoom.filesharingEnabled;

							if (typeof managedRoom.localRecordingEnabled === 'boolean')
								room.localRecordingEnabled = managedRoom.localRecordingEnabled;

							// Settings: only override logo/background if they are non-empty.
							const currentSettings: RoomSettings = room.settings ?? {} as RoomSettings;

							if (managedRoom.logo)
								currentSettings.logo = managedRoom.logo;

							if (managedRoom.background)
								currentSettings.background = managedRoom.background;

							// Do NOT touch codec/audio/screen sharing settings here:
							// constructor + config.defaultRoomSettings already set sane defaults.

							room.settings = currentSettings;
						}
					}

					room.resolveRoomReady();
				} catch (error) {
					logger.error(
						{ roomId, tenantId, err: error },
						'handleConnection() error while getting room'
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
