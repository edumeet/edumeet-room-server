import config from '../config/config.json';
import io from 'socket.io-client';
import { Application, FeathersService, feathers } from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio-client';
import authentication from '@feathersjs/authentication-client';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Peer } from './Peer';
import Room from './Room';
import { ManagedGroup, ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoom, ManagedRoomOwner, ManagedUser, ManagedUserRole } from './common/types';
import MediaService from './MediaService';
import { Config } from './Config';
import { addGroupUser, addRolePermission, addRoomGroupRole, addRoomOwner, addRoomUserRole, removeGroup, removeGroupUser, removeRole, removeRolePermission, removeRoomGroupRole, removeRoomOwner, removeRoomUserRole, updateRoom } from './common/authorization';

const actualConfig = config as Config;

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

	public ready = new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	});

	#client: Application;
	#reAuthTimer: NodeJS.Timer;

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

		if (!actualConfig.managementService)
			logger.debug('Management service not configured');

		this.#client = feathers()
			.configure(socketio(io(actualConfig.managementService?.host ?? '')))
			.configure(authentication());

		this.#roomsService = this.#client.service('rooms');
		this.#roomOwnersService = this.#client.service('roomOwners');
		this.#roomUserRolesService = this.#client.service('roomUserRoles');
		this.#roomGroupRolesService = this.#client.service('roomGroupRoles');

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
	public async getRoom(name: string, tenantId: string): Promise<ManagedRoom | undefined> {
		logger.debug('getRoom() [name: %s]', name);

		await this.ready;

		const { total, data } = await this.#roomsService.find({ query: { name, tenantId } });

		logger.debug('getRoom() [name: %s] -> data: %o', name, data);

		if (total === 1) return data[0];
	}

	@skipIfClosed
	private authenticate(): void {
		logger.debug('authenticate()');

		if (!process.env.MANAGEMENT_USERNAME || !process.env.MANAGEMENT_PASSWORD)
			throw new Error('Management service credentials not configured');
		
		this.ready = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});

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