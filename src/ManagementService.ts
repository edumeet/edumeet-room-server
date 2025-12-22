import io from 'socket.io-client';
import { Application, FeathersService, feathers } from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio-client';
import authentication from '@feathersjs/authentication-client';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Peer } from './Peer';
import Room from './Room';
import { ManagedGroup, ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoom, ManagedRoomOwner, ManagedUser, ManagedUserRole } from './common/types';
import MediaService from './MediaService';
import { getConfig } from './Config';
import { addGroupUser, addRolePermission, addRoomGroupRole, addRoomOwner, addRoomUserRole, removeGroup, removeGroupUser, removeRole, removeRolePermission, removeRoomGroupRole, removeRoomOwner, removeRoomUserRole, updateRoom } from './common/authorization';
import { safePromise } from './common/safePromise';

const config = getConfig();
const logger = new Logger('ManagementService');

interface ManagementServiceOptions {
	managedRooms: Map<string, Room>;
	managedPeers: Map<string, Peer>;
	mediaService: MediaService;
}

export default class ManagementService {
	public closed = false;

	#managedRooms: Map<string, Room>;
	#managedPeers: Map<string, Peer>;
	#mediaService: MediaService;

	public resolveReady!: () => void;
	// eslint-disable-next-line no-unused-vars
	public rejectReady!: (error: unknown) => void;

	public ready = safePromise(new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	}));

	#client: Application;
	#reAuthTimer: NodeJS.Timeout;

	#defaultsService: FeathersService;
	#roomsService: FeathersService;
	#roomOwnersService: FeathersService;
	#roomUserRolesService: FeathersService;
	#roomGroupRolesService: FeathersService;

	#usersService: FeathersService;
	#groupsService: FeathersService;
	#groupUsersService: FeathersService;

	#rolesService: FeathersService;
	#rolePermissionsService: FeathersService;

	constructor({ managedRooms, managedPeers, mediaService }: ManagementServiceOptions) {
		logger.debug('constructor()');

		this.#managedRooms = managedRooms;
		this.#managedPeers = managedPeers;
		this.#mediaService = mediaService;

		if (!config.managementService)
			logger.debug('Management service not configured');

		this.#client = feathers()
			.configure(socketio(io(config.managementService?.host ?? '')))
			.configure(authentication());

		this.#roomsService = this.#client.service('rooms');
		this.#roomOwnersService = this.#client.service('roomOwners');
		this.#roomUserRolesService = this.#client.service('roomUserRoles');
		this.#roomGroupRolesService = this.#client.service('roomGroupRoles');
		this.#defaultsService = this.#client.service('defaults');

		this.#usersService = this.#client.service('users');
		this.#groupsService = this.#client.service('groups');
		this.#groupUsersService = this.#client.service('groupUsers');

		this.#rolesService = this.#client.service('roles');
		this.#rolePermissionsService = this.#client.service('rolePermissions');

		this.authenticate();
		this.#reAuthTimer = setInterval(() => this.authenticate(), 3600000);
		this.setupListeners();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;
		clearInterval(this.#reAuthTimer);
		this.#client.logout();
	}

	@skipIfClosed
	public async getRoom(name: string, tenantId: number): Promise<ManagedRoom | undefined> {
		logger.debug('getRoom() [name: %s, tenantid: %s]', name, tenantId);

		const [ error ] = await this.ready;

		if (error) throw error;

		// Room exist on mgmt
		const { total, data } = await this.#roomsService.find({ query: { name, tenantId } });

		let room = undefined;

		if (total === 1) {
			logger.debug('getRoom() [name: %s] -> data: %o', name, data);
			room = data[0] as ManagedRoom;
		}

		let fdata = undefined;

		const fallback = await this.#defaultsService.find({ query: { name, tenantId } });

		if (fallback.total === 1) {
			logger.debug('getRoom() [name: %s] -> fallback: %o', name, fallback);
			fdata = fallback.data[0];
		}

		if (fdata === undefined) {
			return room;
		}

		let maxFileSize = 100_000_000;

		if (fdata.maxFileSize)
			maxFileSize = fdata.maxFileSize * 1_000_000;

		if (room !== undefined) {
			// FALLBACK from Default if not set by room owner
			room.defaultRoleId = room.defaultRoleId || fdata.defaultRoleId || '';
			room.defaultRole = room.defaultRole || fdata.defaultRole || [];
			room.logo = room.logo || fdata.logo || '';
			room.background = room.background || fdata.background || '';
			room.tracker = room.tracker || fdata.tracker || config.tracker || '';
			room.maxFileSize = room.maxFileSize || maxFileSize;
		} else {
			// FALLBACK
			// get roles with a virt adapter on mgmt side
			// TODO finish user and group roles
			const defaultRoom = {
				id: 0,
				name: '',
				description: '',
				createdAt: 0,
				updatedAt: 0,
				creatorId: 0,
				tenantId: tenantId,
				owners: [],
				groupRoles: [],
				userRoles: [],
				defaultRole: fdata.defaultRole || [],
				maxActiveVideos: 12,
				locked: fdata.lockedUnmanaged,
				tracker: fdata.tracker || config.tracker || '',
				maxFileSize: maxFileSize,
				breakoutsEnabled: fdata.breakoutsEnabledUnmanaged,
				chatEnabled: fdata.chatEnabledUnmanaged,
				reactionsEnabled: fdata.reactionsEnabledUnmanaged,
				raiseHandEnabled: fdata.raiseHandEnabledUnmanaged,
				filesharingEnabled: fdata.filesharingEnabledUnmanaged,
				localRecordingEnabled: fdata.localRecordingEnabledUnmanaged,
				logo: fdata.logo || '',
				background: fdata.background || ''
			};

			room = defaultRoom;
		}

		return room;
	}

	@skipIfClosed
	private authenticate(): void {
		logger.debug('authenticate()');

		if (!process.env.MANAGEMENT_USERNAME || !process.env.MANAGEMENT_PASSWORD)
			throw new Error('Management service credentials not configured');
		
		this.#client.authenticate({
			strategy: 'local',
			email: process.env.MANAGEMENT_USERNAME,
			password: process.env.MANAGEMENT_PASSWORD
		})
			.then(this.resolveReady)
			.catch(this.rejectReady);

		this.#client.io.on('disconnect', () => {
			logger.debug('Socket connection disconnected');
			// TODO: handle explicit disconnect
		});
	}

	@skipIfClosed
	private setupListeners() {
		logger.debug('setupListeners()');

		// Room related services
		this.registerRoomsServiceListeners();
		this.registerRoomOwnersServiceListeners();
		this.registerRoomUserRolesServiceListeners();
		this.registerRoomGroupRolesServiceListeners();

		// User related services
		this.registerUsersServiceListeners();
		this.registerGroupsServiceListeners();
		this.registerGroupUsersServiceListeners();

		// Role related services
		this.registerRolesServiceListeners();
		this.registerRolePermissionsServiceListeners();
	}

	@skipIfClosed
	private registerRoomsServiceListeners(): void {
		this.#roomsService
			.on('patched', (managedRoom: ManagedRoom) => {
				logger.debug('roomsService "patched" event [roomId: %s]', managedRoom.id);

				const room = this.#managedRooms.get(String(managedRoom.id));

				if (room) updateRoom(room, managedRoom);
			});
	}

	@skipIfClosed
	private registerRoomOwnersServiceListeners(): void {
		this.#roomOwnersService
			.on('created', (roomOwner: ManagedRoomOwner) => {
				logger.debug('roomOwnersService "created" event [roomId: %s]', roomOwner.id);

				const room = this.#managedRooms.get(roomOwner.roomId);

				if (room) addRoomOwner(room, roomOwner);
			})
			.on('removed', (roomOwner: ManagedRoomOwner) => {
				logger.debug('roomOwnersService "removed" event [roomId: %s]', roomOwner.id);

				const room = this.#managedRooms.get(roomOwner.roomId);

				if (room) removeRoomOwner(room, roomOwner);
			});
	}

	@skipIfClosed
	private registerRoomUserRolesServiceListeners(): void {
		this.#roomUserRolesService
			.on('created', (roomUserRole: ManagedUserRole) => {
				logger.debug('roomUserRolesService "created" event [roomId: %s]', roomUserRole.id);

				const room = this.#managedRooms.get(roomUserRole.roomId);

				if (room) addRoomUserRole(room, roomUserRole);
			})
			.on('removed', (roomUserRole: ManagedUserRole) => {
				logger.debug('roomUserRolesService "removed" event [roomId: %s]', roomUserRole.id);

				const room = this.#managedRooms.get(roomUserRole.roomId);

				if (room) removeRoomUserRole(room, roomUserRole);
			});
	}

	@skipIfClosed
	private registerRoomGroupRolesServiceListeners(): void {
		this.#roomGroupRolesService
			.on('created', (roomGroupRole: ManagedGroupRole) => {
				logger.debug('roomGroupRolesService "created" event [roomId: %s]', roomGroupRole.id);

				const room = this.#managedRooms.get(roomGroupRole.roomId);

				if (room) addRoomGroupRole(room, roomGroupRole);
			})
			.on('removed', (roomGroupRole: ManagedGroupRole) => {
				logger.debug('roomGroupRolesService "removed" event [roomId: %s]', roomGroupRole.id);

				const room = this.#managedRooms.get(roomGroupRole.roomId);

				if (room) removeRoomGroupRole(room, roomGroupRole);
			});
	}

	@skipIfClosed
	private registerUsersServiceListeners(): void {
		this.#usersService
			.on('removed', (user: ManagedUser) => {
				logger.debug('usersService "removed" event [userId: %s]', user.id);

				this.#managedPeers.get(String(user.id))?.close();
			});
	}

	@skipIfClosed
	private registerGroupsServiceListeners(): void {
		this.#groupsService
			.on('removed', (group: ManagedGroup) => {
				logger.debug('groupsService "removed" event [groupId: %s]', group.id);

				this.#managedRooms.forEach((r) => removeGroup(r, group));
			});
	}

	@skipIfClosed
	private registerGroupUsersServiceListeners(): void {
		this.#groupUsersService
			.on('created', (groupUser: ManagedGroupUser) => {
				logger.debug('groupUsersService "created" event [groupId: %s]', groupUser.id);

				this.#managedRooms.forEach((r) => addGroupUser(r, groupUser));
			})
			.on('removed', (groupUser: ManagedGroupUser) => {
				logger.debug('groupUsersService "removed" event [groupId: %s]', groupUser.id);

				this.#managedRooms.forEach((r) => removeGroupUser(r, groupUser));
			});
	}

	@skipIfClosed
	private registerRolesServiceListeners(): void {
		this.#rolesService
			.on('removed', (role: ManagedRole) => {
				logger.debug('rolesService "removed" event [roleId: %s]', role.id);

				this.#managedRooms.forEach((r) => removeRole(r, role));
			});
	}

	@skipIfClosed
	private registerRolePermissionsServiceListeners(): void {
		this.#rolePermissionsService
			.on('created', (rolePermission: ManagedRolePermission) => {
				logger.debug('rolePermissionsService "created" event [roleId: %s]', rolePermission.id);

				this.#managedRooms.forEach((r) => addRolePermission(r, rolePermission));
			})
			.on('removed', (rolePermission: ManagedRolePermission) => {
				logger.debug('rolePermissionsService "removed" event [roleId: %s]', rolePermission.id);

				this.#managedRooms.forEach((r) => removeRolePermission(r, rolePermission));
			});
	}
}
