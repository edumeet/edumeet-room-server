import { EventEmitter } from 'events';
import MediaService from './MediaService';
import { createMediaMiddleware } from './middlewares/mediaMiddleware';
import { Peer, PeerContext } from './Peer';
import {
	allowedPeers,
	isAllowed,
	isAllowedBecauseMissing,
	Permission,
	promoteOnHostJoin,
	userRoles,
	allowWhenRoleMissing,
	roomPermissions
} from './common/authorization';
import { randomUUID } from 'crypto';
import { createPeerMiddleware } from './middlewares/peerMiddleware';
import { createChatMiddleware } from './middlewares/chatMiddleware';
import { createLockMiddleware } from './middlewares/lockMiddleware';
import { createFileMiddleware } from './middlewares/fileMiddleware';
import { createLobbyPeerMiddleware } from './middlewares/lobbyPeerMiddleware';
import { createLobbyMiddleware } from './middlewares/lobbyMiddleware';
import { createModeratorMiddleware } from './middlewares/moderatorMiddleware';
import { createJoinMiddleware } from './middlewares/joinMiddleware';
import { createInitialMediaMiddleware } from './middlewares/initialMediaMiddleware';
import { MiddlewareOptions } from './common/types';
import { createBreakoutMiddleware } from './middlewares/breakoutMiddleware';
import { Router } from './media/Router';
import { List, Logger, Middleware, skipIfClosed } from 'edumeet-common';

const logger = new Logger('Room');

interface RoomOptions {
	id: string;
	name?: string;
	mediaService: MediaService;
	parent?: Room;
}

export default class Room extends EventEmitter {
	public id: string;
	public name?: string;
	public sessionId = randomUUID();
	public closed = false;
	public locked = false;
	public readonly creationTimestamp = Date.now();
	
	public parent?: Room;
	public routers = List<Router>();
	public rooms = List<Room>();
	public pendingPeers = List<Peer>();
	public peers = List<Peer>();
	public lobbyPeers = List<Peer>();

	private lobbyPeerMiddleware: Middleware<PeerContext>;
	private initialMediaMiddleware: Middleware<PeerContext>;
	private joinMiddleware: Middleware<PeerContext>;
	private peerMiddlewares: Middleware<PeerContext>[] = [];

	constructor({ id, name, mediaService, parent }: RoomOptions) {
		logger.debug('constructor() [id: %s, parent: %s]', id, parent?.id);

		super();

		this.id = id;
		this.name = name;
		this.parent = parent;

		const middlewareOptions = {
			room: this,
			mediaService,
			chatHistory: [],
			fileHistory: [],
		} as MiddlewareOptions;

		this.lobbyPeerMiddleware = createLobbyPeerMiddleware(middlewareOptions);
		this.initialMediaMiddleware = createInitialMediaMiddleware(middlewareOptions);
		this.joinMiddleware = createJoinMiddleware(middlewareOptions);

		this.peerMiddlewares.push(
			createPeerMiddleware(middlewareOptions),
			createModeratorMiddleware(middlewareOptions),
			createMediaMiddleware(middlewareOptions),
			createChatMiddleware(middlewareOptions),
			createFileMiddleware(middlewareOptions),
			createLockMiddleware(middlewareOptions),
			createLobbyMiddleware(middlewareOptions),
			createBreakoutMiddleware(middlewareOptions),
		);
	}

	@skipIfClosed
	public close() {
		logger.debug('close() [id: %s]', this.id);

		this.closed = true;

		if (!this.parent) {
			this.pendingPeers.items.forEach((p) => p.close());
			this.peers.items.forEach((p) => p.close());
			this.lobbyPeers.items.forEach((p) => p.close());
		}

		this.rooms.items.forEach((r) => r.close());
		this.routers.items.forEach((r) => r.close());

		this.pendingPeers.clear();
		this.peers.clear();
		this.lobbyPeers.clear();
		this.rooms.clear();
		this.routers.clear();

		this.emit('close');
	}

	public get parentClosed(): boolean {
		return this.parent?.parentClosed ?? this.closed;
	}

	public get empty(): boolean {
		return this.pendingPeers.empty && this.peers.empty && this.lobbyPeers.empty;
	}

	public addRoom(room: Room): void {
		logger.debug('addRoom() [id: %s]', room.id);

		this.rooms.add(room);
		room.once('close', () => this.rooms.remove(room));
	}

	public addRouter(router: Router): void {
		if (this.parent)
			this.parent.addRouter(router);
		else
			this.pushRouter(router);
	}

	@skipIfClosed
	private pushRouter(router: Router): void {
		if (this.routers.has(router)) return;

		this.routers.add(router);
	}

	@skipIfClosed
	public addPeer(peer: Peer): void {
		logger.debug('addPeer() [id: %s]', peer.id);
		
		peer.once('close', () => this.removePeer(peer));

		// TODO: handle reconnect
		if (isAllowed(this, peer))
			this.allowPeer(peer);
		else
			this.parkPeer(peer);

		// Register this listener to promote the peer if it is
		// in the lobby and gets a role that allows it to pass
		peer.on('gotRole', () => {
			if (this.lobbyPeers.has(peer) && isAllowed(this, peer))
				this.promotePeer(peer);
		});
	}

	@skipIfClosed
	public removePeer(peer: Peer): void {
		logger.debug('removePeer() [sessionId: %s, id: %s]', this.sessionId, peer.id);

		if (this.pendingPeers.remove(peer)) {
			peer.pipeline.remove(this.initialMediaMiddleware);
			peer.pipeline.remove(this.joinMiddleware);
		}

		if (this.peers.remove(peer)) {
			peer.pipeline.remove(this.initialMediaMiddleware);
			this.peerMiddlewares.forEach((m) => peer.pipeline.remove(m));

			this.notifyPeers('peerClosed', { peerId: peer.id }, peer);

			// No peers left with PROMOTE_PEER, might need to give
			// lobbyPeers to peers that are left
			if (isAllowedBecauseMissing(this, peer, Permission.PROMOTE_PEER)) {
				const lobbyPeers = this.lobbyPeers.items.map((p) => (p.peerInfo));

				allowedPeers(this, Permission.PROMOTE_PEER).forEach((p) =>
					p.notify({ method: 'parkedPeers', data: { lobbyPeers } }));
			}
		}
		
		if (this.lobbyPeers.remove(peer)) {
			peer.pipeline.remove(this.lobbyPeerMiddleware);

			this.notifyPeers('lobby:peerClosed', { peerId: peer.id }, peer);
		}

		// If the Room is the root room and there are no more peers in it, close
		if (this.empty && !this.parent)
			this.close();
	}

	@skipIfClosed
	private allowPeer(peer: Peer): void {
		logger.debug('allowPeer() [sessionId: %s, id: %s]', this.sessionId, peer.id);

		this.pendingPeers.add(peer);
		peer.pipeline.use(this.initialMediaMiddleware, this.joinMiddleware);

		peer.notify({
			method: 'roomReady',
			data: {
				sessionId: this.sessionId,
				creationTimestamp: this.creationTimestamp,
				roles: peer.roles.map((role) => role.id),
				roomPermissions,
				userRoles,
				allowWhenRoleMissing
			}
		});

		if (promoteOnHostJoin(this, peer))
			this.promoteAllPeers();
	}

	@skipIfClosed
	private parkPeer(peer: Peer): void {
		logger.debug('parkPeer() [id: %s]', peer.id);

		this.lobbyPeers.add(peer);
		peer.pipeline.use(this.lobbyPeerMiddleware);
		peer.notify({ method: 'enteredLobby', data: {} });

		allowedPeers(this, Permission.PROMOTE_PEER).forEach((p) =>
			p.notify({ method: 'parkedPeer', data: { peerId: peer.id } }));
	}

	@skipIfClosed
	public joinPeer(peer: Peer): void {
		logger.debug('joinPeer() [id: %s]', peer.id);

		peer.pipeline.remove(this.joinMiddleware);
		this.pendingPeers.remove(peer);
		peer.pipeline.use(...this.peerMiddlewares);
		this.peers.add(peer);

		this.notifyPeers('newPeer', {
			...peer.peerInfo
		}, peer);
	}

	@skipIfClosed
	public promoteAllPeers(): void {
		for (const peer of this.lobbyPeers.items) {
			this.promotePeer(peer);
		}
	}

	@skipIfClosed
	public promotePeer(peer: Peer): void {
		logger.debug('promotePeer() [id: %s]', peer.id);

		peer.pipeline.remove(this.lobbyPeerMiddleware);
		this.lobbyPeers.remove(peer);
		this.notifyPeers('lobby:promotedPeer', { peerId: peer.id }, peer);
		this.allowPeer(peer);
	}

	public getPeers(excludePeer?: Peer): Peer[] {
		return this.peers.items.filter((p) => p !== excludePeer);
	}

	@skipIfClosed
	public notifyPeers(method: string, data: unknown, excludePeer?: Peer): void {
		const peers = this.getPeers(excludePeer);

		for (const peer of peers) {
			peer.notify({ method, data });
		}
	}
}