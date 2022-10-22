import { skipIfClosed } from './common/decorators';
import { Logger } from './common/logger';
import { verifyPeer } from './common/token';
import MediaService from './MediaService';
import { Peer } from './Peer';
import Room from './Room';
import { BaseConnection } from './signaling/BaseConnection';

const logger = new Logger('ServerManager');

export default class ServerManager {
	public static async create(): Promise<ServerManager> {
		logger.debug('create()');

		const mediaService = await MediaService.create();

		return new ServerManager({ mediaService });
	}

	public closed = false;
	public peers = new Map<string, Peer>();
	public rooms = new Map<string, Room>();
	public mediaService: MediaService;

	constructor({ mediaService }: { mediaService: MediaService }) {
		logger.debug('constructor()');

		this.mediaService = mediaService;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.mediaService.close();
		this.peers.forEach((p) => p.close());
		this.rooms.forEach((r) => r.close());
		this.peers.clear();
		this.rooms.clear();
	}

	@skipIfClosed
	public handleConnection(
		connection: BaseConnection,
		peerId: string,
		roomId: string,
		displayName?: string,
		token?: string,
	): void {
		logger.debug(
			'handleConnection() [peerId: %s, displayName: %s, roomId: %s]',
			peerId,
			displayName,
			roomId
		);

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
			if (token && verifyPeer(peerId, token)) {
				peer.close();
				this.peers.delete(peerId);
			} else
				throw new Error('Invalid token');
		}

		let room = this.rooms.get(roomId);
		let newRoom = false;

		if (!room) {
			logger.debug(
				'handleConnection() new room [roomId: %s]',
				roomId
			);

			room = new Room({
				id: roomId,
				mediaService: this.mediaService
			});

			newRoom = true;
			this.rooms.set(roomId, room);

			room.once('close', () => {
				logger.debug('handleConnection() room closed [roomId: %s]', roomId);
				this.rooms.delete(roomId);
			});
		}

		peer = new Peer({
			id: peerId,
			token,
			roomId,
			displayName,
			connection
		});

		this.peers.set(peerId, peer);

		peer.once('close', () => {
			logger.debug('handleConnection() peer closed [peerId: %s]', peerId);
			this.peers.delete(peerId);
		});

		try {
			room.addPeer(peer);
		} catch (error) {
			peer.close();

			if (newRoom)
				room.close();

			throw error;
		}

		// At this point we have a valid Peer that is waiting in the Join dialog.
		// Register middleware to handle the Peer actually joining the room. For
		// now, prime the room to be created if it does not exist.
	}
}