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
	managementService: ManagementService;
}

export default class ServerManager {
	public closed = false;
	public peers: Map<string, Peer>;
	public rooms: Map<string, Room>;
	public pendingRooms = new Map<string, Promise<Room>>();
	public mediaService: MediaService;
	public managementService: ManagementService;

	constructor({ mediaService, peers, rooms, managementService }: ServerManagerOptions) {
		logger.debug('constructor()');

		this.mediaService = mediaService;
		this.peers = peers;
		this.rooms = rooms;
		this.managementService = managementService;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaService.close();
		this.peers.forEach((p) => p.close());
		this.rooms.forEach((r) => r.close());
		this.pendingRooms.forEach((p) => p.then((r) => r.close()));
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

		// TODO: need to look-up the room in the management service

		/* let peer = this.peers.get(peerId);

		if (peer) {
			logger.debug(
				'handleConnection() there is already a Peer with same peerId [peerId: %s]',
				peerId
			);

			// If we already have a Peer and the new connection does not have a token
			// then we must close the new connection.
			// As long as the token is correct for the Peer, we can accept the new
			// connection and close the old one.
			if (token && verifyPeer(peerId, token)) {
				peer.close();
				this.peers.delete(peerId);
			} else
				throw new Error('Invalid token');
		} */

		/* let room = this.rooms.get(`${tenantId}/${roomId}`);

		if (!room) {
			logger.debug(
				'handleConnection() new room [roomId: %s, tenantId: %s]',
				roomId,
				tenantId
			);

			const 

			room = new Room({
				id: roomId,
				tenantId,
				mediaService: this.mediaService
			});

			this.rooms.set(`${tenantId}/${roomId}`, room);

			room.once('close', () => {
				logger.debug('handleConnection() room closed [roomId: %s]', roomId);
				this.rooms.delete(roomId);
			});
		}

		peer = new Peer({
			id: peerId,
			token,
			sessionId: room.sessionId,
			displayName,
			connection
		});

		this.peers.set(peerId, peer);

		peer.once('close', () => {
			logger.debug('handleConnection() peer closed [peerId: %s]', peerId);
			this.peers.delete(peerId);
		});

		room.addPeer(peer); */

		// At this point we have a valid Peer that is waiting in the Join dialog.
		// Register middleware to handle the Peer actually joining the room. For
		// now, prime the room to be created if it does not exist.
	}
}