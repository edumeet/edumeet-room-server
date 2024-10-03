import { EventEmitter } from 'events';
import MediaService from './MediaService';
import { createMediaMiddleware } from './middlewares/mediaMiddleware';
import { Peer, PeerContext } from './Peer';
import { randomUUID } from 'crypto';
import { createPeerMiddleware } from './middlewares/peerMiddleware';
import { createChatMiddleware } from './middlewares/chatMiddleware';
import { createDrawingMiddleware } from './middlewares/drawingMiddleware';
import { createLockMiddleware } from './middlewares/lockMiddleware';
import { createFileMiddleware } from './middlewares/fileMiddleware';
import { createLobbyPeerMiddleware } from './middlewares/lobbyPeerMiddleware';
import { createLobbyMiddleware } from './middlewares/lobbyMiddleware';
import { createModeratorMiddleware } from './middlewares/moderatorMiddleware';
import { createJoinMiddleware } from './middlewares/joinMiddleware';
import { createInitialMediaMiddleware } from './middlewares/initialMediaMiddleware';
import { ChatMessage, FileMessage, ManagedGroupRole, ManagedRole, ManagedRoomOwner, ManagedUserRole, RoomRole, RoomSettings } from './common/types';
import { createBreakoutMiddleware } from './middlewares/breakoutMiddleware';
import { List, Logger, Middleware, skipIfClosed } from 'edumeet-common';
import { MediaNode } from './media/MediaNode';
import BreakoutRoom from './BreakoutRoom';
import { Permission, isAllowed, updatePeerPermissions } from './common/authorization';
import { safePromise } from './common/safePromise';
import type { RtpCapabilities } from 'mediasoup/node/lib/RtpParameters';
import { IceServer, getCredentials, getIceServers } from './common/turnCredentials';
import { SctpCapabilities } from 'mediasoup/node/lib/SctpParameters';
import { Router } from './media/Router';

const logger = new Logger('Room');

interface RoomOptions {
	id: string;
	name?: string;
	mediaService: MediaService;
}

export class RoomClosedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RoomClosedError';
	}
}
interface Drawing {
	isEnabled: boolean;
	bgColor: string;
}

export default class Room extends EventEmitter {
	public sessionId = randomUUID();
	public closed = false;
	public id: string;
	public readonly creationTimestamp = Date.now();

	public managedId?: string; // Possibly updated by the management service
	public name?: string; // Possibly updated by the management service
	public description?: string; // Possibly updated by the management service
	public owners: ManagedRoomOwner[] = []; // Possibly updated by the management service
	public userRoles: ManagedUserRole[] = []; // Possibly updated by the management service
	public groupRoles: ManagedGroupRole[] = []; // Possibly updated by the management service
	public defaultRole?: ManagedRole | RoomRole; // Possibly updated by the management service
	public locked = true; // Possibly updated by the management service
	public promoteOnHostJoin = false; // Possibly updated by the management service

	public maxActiveVideos = 12; // Possibly updated by the management service
	public breakoutsEnabled = true; // Possibly updated by the management service
	public chatEnabled = true; // Possibly updated by the management service
	public filesharingEnabled = true; // Possibly updated by the management service
	public drawingEnabled = true; // Possibly updated by the management service
	public raiseHandEnabled = true; // Possibly updated by the management service
	public localRecordingEnabled = true; // Possibly updated by the management service

	public settings: RoomSettings = {};

	public resolveRoomReady!: () => void;
	// eslint-disable-next-line no-unused-vars
	public rejectRoomReady!: (error: Error) => void;
	public roomReady = safePromise(new Promise<void>((resolve, reject) => {
		this.resolveRoomReady = () => {
			logger.debug('roomReady() "resolved" [id: %s, took: %d]', this.id, Date.now() - this.creationTimestamp);

			resolve();
		};

		this.rejectRoomReady = (error: Error) => {
			logger.error('roomReady() "rejected" [id: %s, error: %o]', this.id, error);

			reject(error);
		};
	}));

	public mediaService: MediaService;
	public mediaNodes = List<MediaNode>();
	public routers = List<Router>();
	public breakoutRooms = new Map<string, BreakoutRoom>();
	public waitingPeers = List<Peer>();
	public pendingPeers = List<Peer>();
	public peers = List<Peer>();
	public lobbyPeers = List<Peer>();

	public chatHistory: ChatMessage[] = [];
	public fileHistory: FileMessage[] = [];

	public drawing = {
		isEnabled: false,
		bgColor: 'gray',
	} as Drawing;

	#lobbyPeerMiddleware: Middleware<PeerContext>;
	#initialMediaMiddleware: Middleware<PeerContext>;
	#joinMiddleware: Middleware<PeerContext>;

	#peerMiddleware: Middleware<PeerContext>;
	#moderatorMiddleware: Middleware<PeerContext>;
	#mediaMiddleware: Middleware<PeerContext>;
	#lockMiddleware: Middleware<PeerContext>;
	#lobbyMiddleware: Middleware<PeerContext>;
	#breakoutMiddleware: Middleware<PeerContext>;
	#chatMiddleware: Middleware<PeerContext>;
	#fileMiddleware: Middleware<PeerContext>;
	#drawingMiddleware: Middleware<PeerContext>;

	#allMiddlewares: Middleware<PeerContext>[] = [];

	constructor({ id, name, mediaService }: RoomOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();

		this.id = id;
		this.name = name;
		this.mediaService = mediaService;

		this.#lobbyPeerMiddleware = createLobbyPeerMiddleware({ room: this });
		this.#initialMediaMiddleware = createInitialMediaMiddleware({ room: this });
		this.#joinMiddleware = createJoinMiddleware({ room: this });
		this.#peerMiddleware = createPeerMiddleware({ room: this });
		this.#moderatorMiddleware = createModeratorMiddleware({ room: this });
		this.#mediaMiddleware = createMediaMiddleware({ room: this });
		this.#lockMiddleware = createLockMiddleware({ room: this });
		this.#lobbyMiddleware = createLobbyMiddleware({ room: this });
		this.#breakoutMiddleware = createBreakoutMiddleware({ room: this });
		this.#chatMiddleware = createChatMiddleware({ room: this });
		this.#fileMiddleware = createFileMiddleware({ room: this });
		this.#drawingMiddleware = createDrawingMiddleware({ room: this });

		this.#allMiddlewares = [
			this.#lobbyPeerMiddleware,
			this.#initialMediaMiddleware,
			this.#joinMiddleware,
			this.#peerMiddleware,
			this.#moderatorMiddleware,
			this.#mediaMiddleware,
			this.#lockMiddleware,
			this.#lobbyMiddleware,
			this.#breakoutMiddleware,
			this.#chatMiddleware,
			this.#fileMiddleware,
			this.#drawingMiddleware,
		];
	}

	@skipIfClosed
	public close() {
		logger.debug('close() [id: %s]', this.id);

		this.closed = true;

		this.pendingPeers.items.forEach((p) => p.close());
		this.peers.items.forEach((p) => p.close());
		this.lobbyPeers.items.forEach((p) => p.close());
		this.breakoutRooms.forEach((r) => r.close());
		this.routers.items.forEach((r) => r.close());

		this.routers.clear();
		this.mediaNodes.clear();
		this.pendingPeers.clear();
		this.peers.clear();
		this.lobbyPeers.clear();
		this.breakoutRooms.clear();

		this.emit('close');
	}

	public get empty(): boolean {
		return this.waitingPeers.empty && this.pendingPeers.empty && this.peers.empty && this.lobbyPeers.empty;
	}

	public addMediaNode(mediaNode: MediaNode): void {
		if (this.mediaNodes.has(mediaNode)) return;
		this.mediaNodes.add(mediaNode);
	}

	public addRouter(router: Router): void {
		if (this.routers.has(router)) return;
		this.routers.add(router);
	}

	@skipIfClosed
	public async addPeer(peer: Peer): Promise<void> {
		logger.debug('addPeer() [id: %s]', peer.id);
		
		peer.once('close', () => this.removePeer(peer));

		try {
			this.waitingPeers.add(peer);

			// This will resolve/reject when we have succeeded/failed to merge the room information from the management service
			const [ error ] = await this.roomReady;

			if (error) throw error;
			if (this.closed) throw new RoomClosedError('room closed');

			this.waitingPeers.remove(peer);

			// This will update the permissions of the peer based on what we possibly got from the management service
			updatePeerPermissions(this, peer);

			if (isAllowed(this, peer))
				this.allowPeer(peer);
			else
				this.parkPeer(peer);
		} catch (error) {
			logger.error('addPeer() [error: %o]', error);

			peer.close();
		}
	}

	@skipIfClosed
	public removePeer(peer: Peer): void {
		logger.debug('removePeer() [sessionId: %s, id: %s]', this.sessionId, peer.id);

		this.#allMiddlewares.forEach((m) => peer.pipeline.remove(m));

		this.waitingPeers.remove(peer);
		this.pendingPeers.remove(peer);

		if (this.peers.remove(peer)) this.notifyPeers('peerClosed', { peerId: peer.id }, peer);
		if (this.lobbyPeers.remove(peer)) this.notifyPeersWithPermission('lobby:peerClosed', { peerId: peer.id }, Permission.PROMOTE_PEER, peer);
		if (this.empty) this.close();
	}

	@skipIfClosed
	private allowPeer(peer: Peer): void {
		logger.debug('allowPeer() [sessionId: %s, id: %s]', this.sessionId, peer.id);

		this.assignRouter(peer);

		this.pendingPeers.add(peer);
		peer.pipeline.use(this.#initialMediaMiddleware, this.#joinMiddleware);

		peer.notify({
			method: 'roomReady',
			data: {
				sessionId: this.sessionId,
				creationTimestamp: this.creationTimestamp,

				maxActiveVideos: this.maxActiveVideos,
				breakoutsEnabled: this.breakoutsEnabled,
				chatEnabled: this.chatEnabled,
				filesharingEnabled: this.filesharingEnabled,
				raiseHandEnabled: this.raiseHandEnabled,
				localRecordingEnabled: this.localRecordingEnabled,

				settings: this.settings,
			}
		});
	}

	@skipIfClosed
	private parkPeer(peer: Peer): void {
		logger.debug('parkPeer() [id: %s]', peer.id);

		this.lobbyPeers.add(peer);
		peer.pipeline.use(this.#lobbyPeerMiddleware);
		peer.notify({ method: 'enteredLobby', data: {} });

		this.notifyPeersWithPermission('parkedPeer', { peerId: peer.id }, Permission.PROMOTE_PEER);
	}

	@skipIfClosed
	public joinPeer(peer: Peer): void {
		logger.debug('joinPeer() [id: %s]', peer.id);

		peer.pipeline.remove(this.#joinMiddleware);
		this.pendingPeers.remove(peer);

		peer.pipeline.use(
			this.#peerMiddleware,
			this.#lobbyMiddleware,
			this.#moderatorMiddleware,
			this.#mediaMiddleware,
			this.#lockMiddleware,
		);

		this.breakoutsEnabled && peer.pipeline.use(this.#breakoutMiddleware);
		this.chatEnabled && peer.pipeline.use(this.#chatMiddleware);
		this.filesharingEnabled && peer.pipeline.use(this.#fileMiddleware);
		this.drawingEnabled && peer.pipeline.use(this.#drawingMiddleware);

		this.peers.add(peer);

		this.notifyPeers('newPeer', { ...peer.peerInfo }, peer);
	}

	@skipIfClosed
	public promoteAllPeers(): void {
		this.lobbyPeers.items.forEach((p) => this.promotePeer(p));
	}

	@skipIfClosed
	public promotePeer(peer: Peer): void {
		logger.debug('promotePeer() [id: %s]', peer.id);

		peer.pipeline.remove(this.#lobbyPeerMiddleware);
		this.lobbyPeers.remove(peer);
		this.notifyPeersWithPermission('lobby:promotedPeer', { peerId: peer.id }, Permission.PROMOTE_PEER, peer);
		this.allowPeer(peer);
	}

	@skipIfClosed
	public notifyPeers(method: string, data: unknown, excludePeer?: Peer): void {
		this.getPeers(excludePeer).forEach((p) => p.notify({ method, data }));
	}

	@skipIfClosed
	public notifyPeersWithPermission(method: string, data: unknown, permission: Permission, excludePeer?: Peer): void {
		this.getPeers(excludePeer)
			.filter((p) => p.hasPermission(permission))
			.forEach((p) => p.notify({ method, data }));
	}

	private async assignRouter(peer: Peer): Promise<void> {
		if (this.closed || peer.closed) return;

		try {
			const [ router, mediaNode ] = await this.mediaService.getRouter(this, peer);

			if (this.closed) throw router.close();

			let iceServers = [] as IceServer[];

			if (mediaNode.turnHostname)
				iceServers = getIceServers({ hostname: mediaNode.turnHostname, ...getCredentials(peer.id, mediaNode.secret, 3600) });
	
			const { rtpCapabilities, sctpCapabilities } = await peer.request({
				method: 'mediaConfiguration',
				data: {
					routerRtpCapabilities: router.rtpCapabilities,
					iceServers,
				}
			}) as { rtpCapabilities: RtpCapabilities, sctpCapabilities: SctpCapabilities };

			router.once('close', () => {
				this.routers.remove(router);
				peer.routerReset();
				this.assignRouter(peer);
			});

			this.addRouter(router);
			this.addMediaNode(mediaNode);
			peer.resolveRouterReady(router);
			
			peer.rtpCapabilities = rtpCapabilities;
			peer.sctpCapabilities = sctpCapabilities;
		} catch (error) {
			logger.error('assignRouter() [%o]', error);

			peer.notify({ method: 'noMediaServer' });

			setTimeout(() => this.assignRouter(peer), 10_000);
		}
	}

	public getPeers(excludePeer?: Peer): Peer[] {
		return this.peers.items.filter((p) => p !== excludePeer);
	}

	public getBreakoutRooms(): BreakoutRoom[] {
		return Array.from(this.breakoutRooms.values());
	}

	public getPeerByManagedId(managedId: string): Peer | undefined {
		return this.peers.items.find((p) => p.managedId === managedId) ??
		this.pendingPeers.items.find((p) => p.managedId === managedId) ??
		this.lobbyPeers.items.find((p) => p.managedId === managedId);
	}

	public getPeersByGroupId(groupId: string): Peer[] {
		return [
			...this.peers.items.filter((p) => p.groupIds.includes(groupId)),
			...this.pendingPeers.items.filter((p) => p.groupIds.includes(groupId)),
			...this.lobbyPeers.items.filter((p) => p.groupIds.includes(groupId))
		];
	}
}
