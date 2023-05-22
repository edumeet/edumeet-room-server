import io from 'socket.io-client';
import { feathers } from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio-client';
import authentication from '@feathersjs/authentication-client';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Peer } from './Peer';
import Room from './Room';
import { ManagedGroup, ManagedGroupRole, ManagedGroupUser, ManagedRole, ManagedRolePermission, ManagedRoom, ManagedRoomOwner, ManagedUser, ManagedUserRole } from './common/types';

const logger = new Logger('ManagementService');

interface ManagementServiceOptions {
	peers: Map<string, Peer>;
	rooms: Map<string, Room>;
}

export default class ManagementService {
	public static async create(
		options: ManagementServiceOptions
	): Promise<ManagementService> {
		logger.debug('create()');

		const managementService = new ManagementService(options);

		await managementService.initializeClient();

		return managementService;
	}

	private peers: Map<string, Peer>;
	private rooms: Map<string, Room>;

	// TODO: make map by id from management server

	#client = feathers();

	public closed = false;

	public roomsService = this.#client.service('rooms');
	#roomOwnersService = this.#client.service('roomOwners');
	#roomUserRolesService = this.#client.service('roomUserRoles');
	#roomGroupRolesService = this.#client.service('roomGroupRoles');

	public usersService = this.#client.service('users');
	#groupsService = this.#client.service('groups');
	#groupUsersService = this.#client.service('groupUsers');

	#rolesService = this.#client.service('roles');
	#rolePermissionsService = this.#client.service('rolePermissions');

	constructor({ peers, rooms }: ManagementServiceOptions) {
		logger.debug('constructor()');

		this.peers = peers;
		this.rooms = rooms;
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;
	}

	@skipIfClosed
	private async login(credentials?: { email: string; password: string; }): Promise<void> {
		try {
			if (!credentials) {
				// Try to authenticate using an existing token
				await this.#client.reAuthenticate();
			} else {
				// Otherwise log in with the `local` strategy using the credentials we got
				await this.#client.authenticate({
					strategy: 'local',
					...credentials
				});
			}
		} catch (error) {
			logger.error('login() authentication failed [error: %o]', error);
		}
	}

	@skipIfClosed
	private async initializeClient() {
		logger.debug('initializeClient()');

		this.#client.configure(socketio(io('http://localhost:3000'))); // TODO
		this.#client.configure(authentication());

		await this.login({
			email: process.env.MANAGEMENT_USERNAME as string,
			password: process.env.MANAGEMENT_PASSWORD as string,
		});

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
		this.roomsService
			.on('created', (room: ManagedRoom) =>
				logger.debug('roomsService "created" event [roomId: %s]', room.id)
			)
			.on('removed', (room: ManagedRoom) =>
				logger.debug('roomsService "removed" event [roomId: %s]', room.id)
			)
			.on('patched', (room: ManagedRoom) => {
				logger.debug('roomsService "patched" event [roomId: %s]', room.id);

				// We don't care if the room is not live
				this.rooms.get(String(room.id))?.update(room);
			});
	}

	@skipIfClosed
	private registerRoomOwnersServiceListeners(): void {
		this.#roomOwnersService
			.on('created', (roomOwner: ManagedRoomOwner) => {
				logger.debug('roomOwnersService "created" event [roomId: %s]', roomOwner.id);

				this.rooms.get(String(roomOwner.roomId))?.addRoomOwner(roomOwner);
			})
			.on('removed', (roomOwner: ManagedRoomOwner) => {
				logger.debug('roomOwnersService "removed" event [roomId: %s]', roomOwner.id);

				this.rooms.get(String(roomOwner.roomId))?.removeRoomOwner(roomOwner);
			});
	}

	@skipIfClosed
	private registerRoomUserRolesServiceListeners(): void {
		this.#roomUserRolesService
			.on('created', (roomUserRole: ManagedUserRole) => {
				logger.debug('roomUserRolesService "created" event [roomId: %s]', roomUserRole.id);

				this.rooms.get(String(roomUserRole.roomId))?.addRoomUserRole(roomUserRole);
			})
			.on('removed', (roomUserRole: ManagedUserRole) => {
				logger.debug('roomUserRolesService "removed" event [roomId: %s]', roomUserRole.id);

				this.rooms.get(String(roomUserRole.roomId))?.removeRoomUserRole(roomUserRole);
			});
	}

	@skipIfClosed
	private registerRoomGroupRolesServiceListeners(): void {
		this.#roomGroupRolesService
			.on('created', (roomGroupRole: ManagedGroupRole) => {
				logger.debug('roomGroupRolesService "created" event [roomId: %s]', roomGroupRole.id);

				this.rooms.get(String(roomGroupRole.roomId))?.addRoomGroupRole(roomGroupRole);
			})
			.on('removed', (roomGroupRole: ManagedGroupRole) => {
				logger.debug('roomGroupRolesService "removed" event [roomId: %s]', roomGroupRole.id);

				this.rooms.get(String(roomGroupRole.roomId))?.removeRoomGroupRole(roomGroupRole);
			});
	}

	@skipIfClosed
	private registerUsersServiceListeners(): void {
		this.usersService
			.on('removed', (user: ManagedUser) => {
				logger.debug('usersService "removed" event [userId: %s]', user.id);

				this.peers.forEach((p) => {
					if (p.authenticatedId === user.id) {
						delete p.authenticatedId;
						p.notify({ method: 'deauthenticated' }); // TODO: add to client
					}
				});
			}); // TODO: possibly add patched event for changes to name etc.
	}

	@skipIfClosed
	private registerGroupsServiceListeners(): void {
		this.#groupsService
			.on('removed', (group: ManagedGroup) => {
				logger.debug('groupsService "removed" event [groupId: %s]', group.id);

				this.rooms.forEach((r) => r.removeGroup(group));
			});
	}

	@skipIfClosed
	private registerGroupUsersServiceListeners(): void {
		this.#groupUsersService
			.on('created', (groupUser: ManagedGroupUser) => {
				logger.debug('groupUsersService "created" event [groupId: %s]', groupUser.id);

				this.rooms.forEach((r) => r.addGroupUser(groupUser));
			})
			.on('removed', (groupUser: ManagedGroupUser) => {
				logger.debug('groupUsersService "removed" event [groupId: %s]', groupUser.id);

				this.rooms.forEach((r) => r.removeGroupUser(groupUser));
			});
	}

	@skipIfClosed
	private registerRolesServiceListeners(): void {
		this.#rolesService
			.on('removed', (role: ManagedRole) => {
				logger.debug('rolesService "removed" event [roleId: %s]', role.id);

				this.rooms.forEach((r) => r.removeRole(role));
			});
	}

	@skipIfClosed
	private registerRolePermissionsServiceListeners(): void {
		this.#rolePermissionsService
			.on('created', (rolePermission: ManagedRolePermission) => {
				logger.debug('rolePermissionsService "created" event [roleId: %s]', rolePermission.id);

				this.rooms.forEach((r) => r.addRolePermission(rolePermission));
			})
			.on('removed', (rolePermission: ManagedRolePermission) => {
				logger.debug('rolePermissionsService "removed" event [roleId: %s]', rolePermission.id);

				this.rooms.forEach((r) => r.removeRolePermission(rolePermission));
			});
	}
}