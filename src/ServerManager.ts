import { BaseConnection, Logger, skipIfClosed } from 'edumeet-common';
import { verifyPeer } from './common/token';
import MediaService from './MediaService';
import { Peer } from './Peer';
import Room from './Room';
import ManagementService from './ManagementService';
import { RoomSettings } from './common/types';
import { getConfig } from './Config';
import crypto from 'crypto';

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

	public setPeerManagedId(peer: Peer, newManagedId: string | undefined): void
	{
		const oldManagedId = peer.managedId;

		// No change -> do nothing
		if (oldManagedId === newManagedId)
			return;

		// Remove old mapping
		if (oldManagedId)
			this.managedPeers.delete(String(oldManagedId));

		// Apply new value
		peer.managedId = newManagedId;

		// Add new mapping
		if (peer.managedId)
			this.managedPeers.set(String(peer.managedId), peer);
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
		reconnectKey?: string,
	): void {
		logger.info(
			'handleConnection() [peerId: %s, displayName: %s, roomId: %s, tenantId: %s, token: %s, reconnectKey: %s]',
			peerId,
			displayName,
			roomId,
			tenantId,
			token,
			reconnectKey
		);

		// Enforce: token must be valid whenever provided
		let managedId: string | undefined;

		if (token !== undefined) {
			const res = verifyPeer(token);

			if (!res.ok) {
				throw new Error(res.reason === "expired" ? "Token expired" : "Invalid token");
			}

			managedId = res.managedId;
		}

		// --- 1) Reconnect handling first ---
		const existingPeer = this.peers.get(peerId);

		if (existingPeer) {
			if (!reconnectKey || !existingPeer.reconnectKey || reconnectKey !== existingPeer.reconnectKey) {
				throw new Error('Wrong reconnectKey');
			}

			// If existing peer is managed:
			// - If the reconnect includes a token, it must be valid and match the same managedId.
			// - If the reconnect includes NO token, treat it as a guest downgrade (allowed as long as reconnectKey matches).
			if (existingPeer.managedId) {
				if (managedId) {
					if (managedId !== existingPeer.managedId)
						throw new Error('Invalid token');
				} else {
					logger.debug(
						'handleConnection() managed peer reconnecting without token -> downgrade to guest [peerId: %s, oldManagedId: %s]',
						peerId,
						existingPeer.managedId
					);
				}
			}

			existingPeer.close();
		}

		// --- 2) Room lookup/creation (unchanged from your code) ---
		let room = this.rooms.get(`${tenantId}/${roomId}`);

		if (!room) {
			logger.debug('handleConnection() new room [roomId: %s, tenantId: %s]', roomId, tenantId);

			room = new Room({ id: roomId, mediaService: this.mediaService, serverManager: this });

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
					tracker = undefined,
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

		// --- 3) Create peer (rotate reconnectKey every connect) ---
		const newReconnectKey = crypto.randomBytes(32).toString('base64url');

		const peer = new Peer({
			id: peerId,
			managedId,
			sessionId: room.sessionId,
			displayName,
			connection,
			reconnectKey: newReconnectKey
		});

		this.peers.set(peerId, peer);

		if (managedId)
			this.managedPeers.set(String(managedId), peer);

		peer.once('close', () => {
			logger.debug('handleConnection() peer closed [peerId: %s]', peerId);
			this.peers.delete(peerId);

			if (peer?.managedId)
				this.managedPeers.delete(peer.managedId);
		});

		room.addPeer(peer);

		// --- 4) Send reconnectKey privately to this peer only ---
		peer.notify({
			method: 'reconnectKey',
			data: { reconnectKey: peer.reconnectKey }
		});
	}
}
