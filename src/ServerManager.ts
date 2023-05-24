import { BaseConnection, Logger, skipIfClosed } from 'edumeet-common';
import { verifyPeer } from './common/token';
import MediaService from './MediaService';
import { Peer } from './Peer';
import Room from './Room';
import ManagementService from './ManagementService';

const logger = new Logger('ServerManager');

interface ServerManagerOptions {
	mediaService: MediaService;
	peers: Map<string, Peer>;
	rooms: Map<string, Room>;
	managedPeers: Map<string, Peer>;
	managedRooms: Map<string, Room>;
	managementService: ManagementService;
}

export default class ServerManager {
	public closed = false;
	public peers: Map<string, Peer>;
	public rooms: Map<string, Room>;
	public managedRooms = new Map<string, Room>(); // Mapped by ID from management service
	public managedPeers = new Map<string, Peer>(); // Mapped by ID from management service
	public mediaService: MediaService;
	public managementService: ManagementService;

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
		tenantId: string,
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
			logger.debug(
				'handleConnection() there is already a Peer with same peerId [peerId: %s]',
				peerId
			);

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
			logger.debug(
				'handleConnection() new room [roomId: %s, tenantId: %s]',
				roomId,
				tenantId
			);

			room = new Room({
				id: roomId,
				tenantId,
				mediaService: this.mediaService
			});

			this.rooms.set(`${tenantId}/${roomId}`, room);

			room.once('close', () => {
				logger.debug('handleConnection() room closed [roomId: %s]', roomId);
				this.rooms.delete(`${tenantId}/${roomId}`);

				if (room?.managedId)
					this.managedRooms.delete(room.managedId);
			});

			(async () => {
				try {
					const managedRoom = await this.managementService.getRoom(roomId, tenantId);

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
						room.logo = managedRoom.logo;
						room.background = managedRoom.background;
						room.maxActiveVideos = managedRoom.maxActiveVideos;
						room.locked = managedRoom.locked;
						room.breakoutsEnabled = managedRoom.breakoutsEnabled;
						room.chatEnabled = managedRoom.chatEnabled;
						room.raiseHandEnabled = managedRoom.raiseHandEnabled;
						room.filesharingEnabled = managedRoom.filesharingEnabled;
						room.localRecordingEnabled = managedRoom.localRecordingEnabled;

						this.managedRooms.set(String(managedRoom.id), room);
					}
				} catch (error) {} finally {
					room.resolveRoomReady();
				}
			})();
		}

		peer = new Peer({
			id: peerId,
			managedId,
			sessionId: room.sessionId,
			displayName,
			connection
		});

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