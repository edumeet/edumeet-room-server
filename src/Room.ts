import { EventEmitter } from 'events';
import MediaService from './MediaService';
import { createMediaMiddleware } from './middlewares/mediaMiddleware';
import { Peer, PeerContext } from './Peer';
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
import { ChatMessage, FileMessage, ManagedGroup, ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoom, ManagedRoomOwner, ManagedUserRole } from './common/types';
import { createBreakoutMiddleware } from './middlewares/breakoutMiddleware';
import { Router } from './media/Router';
import { List, Logger, Middleware, skipIfClosed } from 'edumeet-common';
import MediaNode from './media/MediaNode';
import BreakoutRoom from './BreakoutRoom';
import { Permission, allPermissions, isAllowed, peersWithPermission } from './common/authorization';

const logger = new Logger('Room');

interface RoomOptions {
	id: string;
	tenantId: string;
	name?: string;
	mediaService: MediaService;
	owners: ManagedRoomOwner[];
	userRoles: ManagedUserRole[];
	groupRoles: ManagedGroupRole[];
}

export class RoomClosedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RoomClosedError';
	}
}

export default class Room extends EventEmitter {
	public id: string;
	public tenantId: string;
	public owners: ManagedRoomOwner[];
	public userRoles: ManagedUserRole[];
	public groupRoles: ManagedGroupRole[];
	public name?: string;
	public sessionId = randomUUID();
	public closed = false;
	public locked = false;
	public promoteOnHostJoin = false;
	public readonly creationTimestamp = Date.now();

	public mediaService: MediaService;

	public routers = List<Router>();
	public breakoutRooms = new Map<string, BreakoutRoom>();
	public pendingPeers = List<Peer>();
	public peers = List<Peer>();
	public lobbyPeers = List<Peer>();

	public chatHistory: ChatMessage[] = [];
	public fileHistory: FileMessage[] = [];

	private lobbyPeerMiddleware: Middleware<PeerContext>;
	private initialMediaMiddleware: Middleware<PeerContext>;
	private joinMiddleware: Middleware<PeerContext>;
	private peerMiddlewares: Middleware<PeerContext>[] = [];

	constructor({ id, tenantId, name, mediaService, owners, userRoles, groupRoles }: RoomOptions) {
		logger.debug('constructor() [id: %s]', id);

		super();

		this.id = id;
		this.tenantId = tenantId;
		this.name = name;
		this.mediaService = mediaService;
		this.owners = owners;
		this.userRoles = userRoles;
		this.groupRoles = groupRoles;

		this.lobbyPeerMiddleware = createLobbyPeerMiddleware({ room: this });
		this.initialMediaMiddleware = createInitialMediaMiddleware({ room: this });
		this.joinMiddleware = createJoinMiddleware({ room: this });

		this.peerMiddlewares.push(
			createPeerMiddleware({ room: this }),
			createModeratorMiddleware({ room: this }),
			createMediaMiddleware({ room: this }),
			createChatMiddleware({ room: this }),
			createFileMiddleware({ room: this }),
			createLockMiddleware({ room: this }),
			createLobbyMiddleware({ room: this }),
			createBreakoutMiddleware({ room: this }),
		);
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

		this.pendingPeers.clear();
		this.peers.clear();
		this.lobbyPeers.clear();
		this.breakoutRooms.clear();
		this.routers.clear();

		this.emit('close');
	}

	public get empty(): boolean {
		return this.pendingPeers.empty && this.peers.empty && this.lobbyPeers.empty;
	}

	public addRouter(router: Router): void {
		if (this.routers.has(router)) return;

		this.routers.add(router);
	}

	@skipIfClosed
	public addPeer(peer: Peer): void {
		logger.debug('addPeer() [id: %s]', peer.id);
		
		peer.once('close', () => this.removePeer(peer));

		this.updatePeerPermissions(peer);

		// TODO: handle reconnect
		if (isAllowed(this, peer))
			this.allowPeer(peer);
		else
			this.parkPeer(peer);

		// TODO: Promote the peer if it is in the lobby and gets
		// permission that allows it to pass
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
		}
		
		if (this.lobbyPeers.remove(peer)) {
			peer.pipeline.remove(this.lobbyPeerMiddleware);

			this.notifyPeers('lobby:peerClosed', { peerId: peer.id }, peer);
		}

		// If the Room is the root room and there are no more peers in it, close
		if (this.empty)
			this.close();
	}

	@skipIfClosed
	private allowPeer(peer: Peer): void {
		logger.debug('allowPeer() [sessionId: %s, id: %s]', this.sessionId, peer.id);

		this.assignRouter(peer);

		this.pendingPeers.add(peer);
		peer.pipeline.use(this.initialMediaMiddleware, this.joinMiddleware);

		peer.notify({
			method: 'roomReady',
			data: {
				sessionId: this.sessionId,
				creationTimestamp: this.creationTimestamp,
				permissions: peer.permissions,
			}
		});

		// TODO: promote on host join
	}

	@skipIfClosed
	private parkPeer(peer: Peer): void {
		logger.debug('parkPeer() [id: %s]', peer.id);

		this.lobbyPeers.add(peer);
		peer.pipeline.use(this.lobbyPeerMiddleware);
		peer.notify({ method: 'enteredLobby', data: {} });

		peersWithPermission(this, Permission.PROMOTE_PEER).forEach((p) =>
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

	public getBreakoutRooms(): BreakoutRoom[] {
		return Array.from(this.breakoutRooms.values());
	}

	@skipIfClosed
	public notifyPeers(method: string, data: unknown, excludePeer?: Peer): void {
		const peers = this.getPeers(excludePeer);

		for (const peer of peers) {
			peer.notify({ method, data });
		}
	}

	public getActiveMediaNodes(): MediaNode[] {
		return [ ...new Set(
			this.routers.items.map(
				(r) => r.mediaNode as unknown as MediaNode
			)
		) ];
	}

	private async assignRouter(peer: Peer): Promise<void> {
		try {
			const router = await this.mediaService.getRouter(this, peer);

			if (this.closed)
				throw router.close();

			this.addRouter(router);
			peer.resolveRouterReady(router);
		} catch (error) {
			logger.error('assignRouter() [%o]', error);

			peer.rejectRouterReady(error);
		}
	}

	public updatePeerPermissions(peer: Peer): void {
		if (this.owners.find((o) => o.userId === peer.authenticatedId)) {
			peer.permissions = allPermissions;

			return;
		}

		// Find the user roles the peer has, and get the roles for those user roles
		const userPermissions = this.userRoles
			.filter((ur) => ur.userId === peer.authenticatedId)
			.map((ur) => ur.role.permissions.map((p) => p.name))
			.flat();
		// Find the groups the peer is in, and get the roles for those groups
		const groupPermissions = this.groupRoles
			.filter((gr) => peer.groupIds.includes(gr.groupId))
			.map((gr) => gr.role.permissions.map((p) => p.name))
			.flat();

		// Combine and remove duplicates
		peer.permissions = [ ...new Set([ ...userPermissions, ...groupPermissions ]) ];
	}

	@skipIfClosed
	public update(room: ManagedRoom): void {
		logger.debug('update() [id: %s]', this.id);

		this.name = room.name;
		this.locked = room.locked;

		// TODO: handle all possible changes

		this.notifyPeers('roomUpdate', {
			name: this.name,
			locked: this.locked,
		});
	}

	@skipIfClosed
	public addRoomOwner(roomOwner: ManagedRoomOwner): void {
		logger.debug('addRoomOwner() [id: %s]', this.id);

		this.owners.push(roomOwner);

		// Check if the peer is already in the room, if so, notify it
		const peer = this.peers.items.find((p) => p.authenticatedId === roomOwner.userId);

		if (peer) {
			this.updatePeerPermissions(peer);
			peer.notify({ method: 'becameRoomOwner' }); // TODO: add client side
		}
	}

	@skipIfClosed
	public removeRoomOwner(roomOwner: ManagedRoomOwner): void {
		logger.debug('removeRoomOwner() [id: %s]', this.id);

		this.owners = this.owners.filter((o) => o.id !== roomOwner.id);

		// Check if the peer is already in the room, if so, notify it
		const peer = this.peers.items.find((p) => p.authenticatedId === roomOwner.userId);

		if (peer) {
			this.updatePeerPermissions(peer);
			peer.notify({ method: 'lostRoomOwner' }); // TODO: add client side
		}
	}

	@skipIfClosed
	public addRoomUserRole(roomUserRole: ManagedUserRole): void {
		logger.debug('addRoomUserRole() [id: %s]', this.id);

		this.userRoles.push(roomUserRole);

		// Check if the peer is already in the room, if so, notify it
		const peer = this.peers.items.find((p) => p.authenticatedId === roomUserRole.userId);

		if (peer)
			this.updatePeerPermissions(peer);
	}

	@skipIfClosed
	public removeRoomUserRole(roomUserRole: ManagedUserRole): void {
		logger.debug('removeRoomUserRole() [id: %s]', this.id);

		this.userRoles = this.userRoles.filter((ur) => ur.id !== roomUserRole.id);

		// Check if the peer is already in the room, if so, notify it
		const peer = this.peers.items.find((p) => p.authenticatedId === roomUserRole.userId);

		if (peer)
			this.updatePeerPermissions(peer);
	}

	@skipIfClosed
	public addRoomGroupRole(roomGroupRole: ManagedGroupRole): void {
		logger.debug('addRoomGroupRole() [id: %s]', this.id);

		this.groupRoles.push(roomGroupRole);

		// Check if the peer is already in the room, if so, notify it
		const peers = this.peers.items.filter((p) => p.groupIds.includes(roomGroupRole.groupId));

		peers.forEach((peer) => this.updatePeerPermissions(peer));
	}

	@skipIfClosed
	public removeRoomGroupRole(roomGroupRole: ManagedGroupRole): void {
		logger.debug('removeRoomGroupRole() [id: %s]', this.id);

		this.groupRoles = this.groupRoles.filter((gr) => gr.id !== roomGroupRole.id);

		// Check if the peer is already in the room, if so, notify it
		const peers = this.peers.items.filter((p) => p.groupIds.includes(roomGroupRole.groupId));

		peers.forEach((peer) => this.updatePeerPermissions(peer));
	}

	@skipIfClosed
	public removeGroup(group: ManagedGroup): void {
		logger.debug('removeGroup() [id: %s]', this.id);

		this.groupRoles = this.groupRoles.filter((gr) => gr.groupId !== group.id);

		// Check if the peer is already in the room, if so, notify it
		const peers = this.peers.items.filter((p) => p.groupIds.includes(group.id));

		for (const peer of peers) {
			peer.groupIds = peer.groupIds.filter((id) => id !== group.id);

			this.updatePeerPermissions(peer);
		}
	}

	@skipIfClosed
	public addGroupUser(groupUser: ManagedGroupUser): void {
		logger.debug('addGroupUser() [id: %s]', this.id);

		// Check if the peer is already in the room, if so, notify it
		const peer = this.peers.items.find((p) => p.authenticatedId === groupUser.userId);

		if (peer) {
			const groupRole = this.groupRoles.find((gr) => gr.groupId === groupUser.groupId);

			if (groupRole) {
				peer.groupIds.push(groupUser.groupId);
				this.updatePeerPermissions(peer);
			}
		}
	}

	@skipIfClosed
	public removeGroupUser(groupUser: ManagedGroupUser): void {
		logger.debug('removeGroupUser() [id: %s]', this.id);

		// Check if the peer is already in the room, if so, notify it
		const peer = this.peers.items.find((p) => p.authenticatedId === groupUser.userId);

		if (peer) {
			const groupRole = this.groupRoles.find((gr) => gr.groupId === groupUser.groupId);

			if (groupRole) {
				peer.groupIds = peer.groupIds.filter((id) => id !== groupUser.groupId);
				this.updatePeerPermissions(peer);
			}
		}
	}

	@skipIfClosed
	public removeRole(role: ManagedRole): void {
		logger.debug('removeRole() [id: %s]', this.id);

		this.userRoles.forEach((ur) => {
			if (ur.roleId === role.id)
				this.removeRoomUserRole(ur);
		});

		this.groupRoles.forEach((gr) => {
			if (gr.roleId === role.id)
				this.removeRoomGroupRole(gr);
		});
	}

	@skipIfClosed
	public addRolePermission(rolePermission: ManagedRolePermission): void {
		logger.debug('addRolePermission() [id: %s]', this.id);

		this.userRoles.forEach((ur) => {
			if (ur.roleId === rolePermission.roleId) {
				ur.role.permissions.push(rolePermission.permission);

				const peer = this.peers.items.find((p) => p.authenticatedId === ur.userId);

				if (peer)
					this.updatePeerPermissions(peer);
			}
		});

		this.groupRoles.forEach((gr) => {
			if (gr.roleId === rolePermission.roleId) {
				gr.role.permissions.push(rolePermission.permission);

				const peers = this.peers.items.filter((p) => p.groupIds.includes(gr.groupId));

				peers.forEach((peer) => this.updatePeerPermissions(peer));
			}
		});
	}

	@skipIfClosed
	public removeRolePermission(rolePermission: ManagedRolePermission): void {
		logger.debug('removeRolePermission() [id: %s]', this.id);

		this.userRoles.forEach((ur) => {
			if (ur.roleId === rolePermission.roleId) {
				ur.role.permissions = ur.role.permissions.filter((p) => p.id !== rolePermission.permission.id);

				const peer = this.peers.items.find((p) => p.authenticatedId === ur.userId);

				if (peer)
					this.updatePeerPermissions(peer);
			}
		});

		this.groupRoles.forEach((gr) => {
			if (gr.roleId === rolePermission.roleId) {
				gr.role.permissions = gr.role.permissions.filter((p) => p.id !== rolePermission.permission.id);

				const peers = this.peers.items.filter((p) => p.groupIds.includes(gr.groupId));

				peers.forEach((peer) => this.updatePeerPermissions(peer));
			}
		});
	}
}