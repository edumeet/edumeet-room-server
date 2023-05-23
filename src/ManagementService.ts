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
	managedRooms: Map<number, Room>;
	managedPeers: Map<number, Peer>;
}

export default class ManagementService {
	private managedRooms: Map<number, Room>;
	private managedPeers: Map<number, Peer>;

	// eslint-disable-next-line no-unused-vars
	public resolveReady!: () => void;
	// eslint-disable-next-line no-unused-vars
	public rejectReady!: (error: unknown) => void;

	public ready = new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	});

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

	constructor({ managedRooms, managedPeers }: ManagementServiceOptions) {
		logger.debug('constructor()');

		this.managedRooms = managedRooms;
		this.managedPeers = managedPeers;

		this.initialize();
		this.setupListeners();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;
	}

	@skipIfClosed
	public async getRoom(roomId: string, tenantId: string): Promise<ManagedRoom | undefined> {
		logger.debug('getRoom() [roomId: %s]', roomId);

		await this.ready;

		const { total, data } = await this.roomsService.find({
			query: {
				name: roomId,
				tenantId
			}
		});

		if (total === 0) return;
		if (total > 1) throw new Error('multiple rooms found'); // This should be enforced by the management service

		return data[0];
	}

	@skipIfClosed
	private async initialize(): Promise<void> {
		logger.debug('initialize()');

		this.#client.configure(socketio(io(process.env.MANAGEMENT_HOSTNAME as string)));
		this.#client.configure(authentication());

		await this.login({
			email: process.env.MANAGEMENT_USERNAME as string,
			password: process.env.MANAGEMENT_PASSWORD as string,
		})
			.then(this.resolveReady)
			.catch(this.rejectReady);
	}

	@skipIfClosed
	private async login(credentials?: { email: string; password: string; }): Promise<void> {
		logger.debug('login()');

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

			throw error;
		}
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
		this.roomsService
			.on('created', (room: ManagedRoom) =>
				logger.debug('roomsService "created" event [roomId: %s]', room.id)
			)
			.on('removed', (room: ManagedRoom) =>
				logger.debug('roomsService "removed" event [roomId: %s]', room.id)
			)
			.on('patched', (room: ManagedRoom) => {
				logger.debug('roomsService "patched" event [roomId: %s]', room.id);

				this.managedRooms.get(room.id)?.update(room);
			});
	}

	@skipIfClosed
	private registerRoomOwnersServiceListeners(): void {
		this.#roomOwnersService
			.on('created', (roomOwner: ManagedRoomOwner) => {
				logger.debug('roomOwnersService "created" event [roomId: %s]', roomOwner.id);

				this.managedRooms.get(roomOwner.roomId)?.addRoomOwner(roomOwner);
			})
			.on('removed', (roomOwner: ManagedRoomOwner) => {
				logger.debug('roomOwnersService "removed" event [roomId: %s]', roomOwner.id);

				this.managedRooms.get(roomOwner.roomId)?.removeRoomOwner(roomOwner);
			});
	}

	@skipIfClosed
	private registerRoomUserRolesServiceListeners(): void {
		this.#roomUserRolesService
			.on('created', (roomUserRole: ManagedUserRole) => {
				logger.debug('roomUserRolesService "created" event [roomId: %s]', roomUserRole.id);

				this.managedRooms.get(roomUserRole.roomId)?.addRoomUserRole(roomUserRole);
			})
			.on('removed', (roomUserRole: ManagedUserRole) => {
				logger.debug('roomUserRolesService "removed" event [roomId: %s]', roomUserRole.id);

				this.managedRooms.get(roomUserRole.roomId)?.removeRoomUserRole(roomUserRole);
			});
	}

	@skipIfClosed
	private registerRoomGroupRolesServiceListeners(): void {
		this.#roomGroupRolesService
			.on('created', (roomGroupRole: ManagedGroupRole) => {
				logger.debug('roomGroupRolesService "created" event [roomId: %s]', roomGroupRole.id);

				this.managedRooms.get(roomGroupRole.roomId)?.addRoomGroupRole(roomGroupRole);
			})
			.on('removed', (roomGroupRole: ManagedGroupRole) => {
				logger.debug('roomGroupRolesService "removed" event [roomId: %s]', roomGroupRole.id);

				this.managedRooms.get(roomGroupRole.roomId)?.removeRoomGroupRole(roomGroupRole);
			});
	}

	@skipIfClosed
	private registerUsersServiceListeners(): void {
		this.usersService
			.on('removed', (user: ManagedUser) => {
				logger.debug('usersService "removed" event [userId: %s]', user.id);

				const peer = this.managedPeers.get(user.id);

				if (peer) {
					peer.notify({ method: 'deauthenticated' }); // TODO: add to client
					peer.close();
				}
			}); // TODO: possibly add patched event for changes to name etc.
	}

	@skipIfClosed
	private registerGroupsServiceListeners(): void {
		this.#groupsService
			.on('removed', (group: ManagedGroup) => {
				logger.debug('groupsService "removed" event [groupId: %s]', group.id);

				this.managedRooms.forEach((r) => r.removeGroup(group));
			});
	}

	@skipIfClosed
	private registerGroupUsersServiceListeners(): void {
		this.#groupUsersService
			.on('created', (groupUser: ManagedGroupUser) => {
				logger.debug('groupUsersService "created" event [groupId: %s]', groupUser.id);

				this.managedRooms.forEach((r) => r.addGroupUser(groupUser));
			})
			.on('removed', (groupUser: ManagedGroupUser) => {
				logger.debug('groupUsersService "removed" event [groupId: %s]', groupUser.id);

				this.managedRooms.forEach((r) => r.removeGroupUser(groupUser));
			});
	}

	@skipIfClosed
	private registerRolesServiceListeners(): void {
		this.#rolesService
			.on('removed', (role: ManagedRole) => {
				logger.debug('rolesService "removed" event [roleId: %s]', role.id);

				this.managedRooms.forEach((r) => r.removeRole(role));
			});
	}

	@skipIfClosed
	private registerRolePermissionsServiceListeners(): void {
		this.#rolePermissionsService
			.on('created', (rolePermission: ManagedRolePermission) => {
				logger.debug('rolePermissionsService "created" event [roleId: %s]', rolePermission.id);

				this.managedRooms.forEach((r) => r.addRolePermission(rolePermission));
			})
			.on('removed', (rolePermission: ManagedRolePermission) => {
				logger.debug('rolePermissionsService "removed" event [roleId: %s]', rolePermission.id);

				this.managedRooms.forEach((r) => r.removeRolePermission(rolePermission));
			});
	}
}