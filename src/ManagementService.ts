import io, { Socket } from 'socket.io-client';
import { Application, FeathersService, feathers } from '@feathersjs/feathers';
import socketio from '@feathersjs/socketio-client';
import authentication from '@feathersjs/authentication-client';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Peer } from './Peer';
import Room from './Room';
import {
	ManagedGroup,
	ManagedGroupRole,
	ManagedGroupUser,
	ManagedRole,
	ManagedRolePermission,
	ManagedRoom,
	ManagedRoomOwner,
	ManagedTenant,
	ManagedUser,
	ManagedUserRole
} from './common/types';
import MediaService from './MediaService';
import { getConfig } from './Config';
import {
	addGroupUser,
	addRolePermission,
	addRoomGroupRole,
	addRoomOwner,
	addRoomUserRole,
	removeGroup,
	removeGroupUser,
	removeRole,
	removeRolePermission,
	removeRoomGroupRole,
	removeRoomOwner,
	removeRoomUserRole,
	updateRoom
} from './common/authorization';
import { safePromise } from './common/safePromise';

const config = getConfig();
const logger = new Logger('ManagementService');

interface ManagementServiceOptions {
	managedRooms: Map<string, Room>;
	managedPeers: Map<string, Set<Peer>>;
	mediaService: MediaService;
}

type FeathersErrorLike = {
	code?: number;
	className?: string;
	name?: string;
	message?: string;
};

function isNonRecoverableAuthError(err: unknown): boolean {
	const e = err as FeathersErrorLike | undefined;

	// Feathers authentication failures usually come as 401 / not-authenticated.
	if (e?.code === 401) return true;
	if (e?.className === 'not-authenticated') return true;
	if (e?.name === 'NotAuthenticated') return true;

	// Missing credentials / misconfiguration should fail fast.
	if (typeof e?.message === 'string' && e.message.includes('credentials not configured')) return true;

	return false;
}

export default class ManagementService {
	public closed = false;

	#managedRooms: Map<string, Room>;
	#managedPeers: Map<string, Set<Peer>>;
	#mediaService: MediaService;

	public resolveReady!: () => void;
	// eslint-disable-next-line no-unused-vars
	public rejectReady!: (error: unknown) => void;

	public ready = safePromise(new Promise<void>((resolve, reject) => {
		this.resolveReady = resolve;
		this.rejectReady = reject;
	}));

	#client: Application;
	#socket: Socket;

	#authRefreshTimer: NodeJS.Timeout | null = null;
	#refreshAttempt = 0;
	#pendingAuth: Promise<void> | null = null;

	#tenantFQDNsService: FeathersService;
	#tenantsService: FeathersService;

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

		this.#socket = io(config.managementService?.host ?? '', {
			reconnection: true,
			reconnectionAttempts: Infinity,
			transports: [ 'websocket' ]
		});

		this.#client = feathers()
			.configure(socketio(this.#socket))
			.configure(authentication());

		this.#tenantFQDNsService = this.#client.service('tenantFQDNs');
		this.#tenantsService = this.#client.service('tenants');

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

		this.setupSocketLifecycle();

		this.setupListeners();
	}

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		if (this.#authRefreshTimer) {
			clearTimeout(this.#authRefreshTimer);
			this.#authRefreshTimer = null;
		}

		this.#client.logout().catch((err) => logger.warn({ err }, 'logout failed on close'));
		this.#socket.disconnect();
	}

	@skipIfClosed
	public async getRoom(name: string, tenantId: number): Promise<ManagedRoom | undefined> {
		logger.debug('getRoom() [name: %s, tenantid: %s]', name, tenantId);

		const [ error ] = await this.ready;

		if (error) throw error;

		// Room exist on mgmt
		const { total, data } = await this.runAuthenticated(
			() => this.#roomsService.find({ query: { name, tenantId } })
		);

		let room = undefined;

		if (total === 1) {
			logger.debug('getRoom() [name: %s] -> data: %o', name, data);
			room = data[0] as ManagedRoom;
		}

		let fdata = undefined;

		const fallback = await this.runAuthenticated(
			() => this.#defaultsService.find({ query: { name, tenantId } })
		);

		if (fallback.total === 1) {
			logger.debug('getRoom() [name: %s] -> fallback: %o', name, fallback);
			fdata = fallback.data[0];
		}

		if (fdata === undefined) {
			return room;
		}

		let maxFileSize = 100_000_000;

		if (fdata.maxFileSize !== null && fdata.maxFileSize !== undefined) {
			maxFileSize = Math.max(0, Number(fdata.maxFileSize)) * 1_000_000;
		} else if (config.defaultRoomSettings?.maxFileSize !== null &&
			config.defaultRoomSettings?.maxFileSize !== undefined) {
			maxFileSize = Math.max(0, Number(config.defaultRoomSettings.maxFileSize));
		}

		if (room !== undefined) {
			// FALLBACK from Default if not set by room owner
			room.defaultRoleId = room.defaultRoleId || fdata.defaultRoleId || '';
			room.defaultRole = room.defaultRole || fdata.defaultRole || [];
			room.logo = room.logo || fdata.logo || '';
			room.background = room.background || fdata.background || '';
			room.tracker = room.tracker || fdata.tracker || config.defaultRoomSettings?.tracker || '';
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
				disableUnmanaged: Boolean(fdata.disableUnmanaged),
				// If unmanaged rooms are disabled, force locked=true regardless of lockedUnmanaged setting
				locked: Boolean(fdata.disableUnmanaged) || Boolean(fdata.lockedUnmanaged),
				tracker: fdata.tracker || config.defaultRoomSettings?.tracker || '',
				maxFileSize: maxFileSize,
				breakoutsEnabled: Boolean(fdata.breakoutsEnabledUnmanaged),
				chatEnabled: Boolean(fdata.chatEnabledUnmanaged),
				reactionsEnabled: Boolean(fdata.reactionsEnabledUnmanaged),
				raiseHandEnabled: Boolean(fdata.raiseHandEnabledUnmanaged),
				filesharingEnabled: Boolean(fdata.filesharingEnabledUnmanaged),
				localRecordingEnabled: Boolean(fdata.localRecordingEnabledUnmanaged),
				logo: fdata.logo || '',
				background: fdata.background || ''
			};

			room = defaultRoom;
		}

		return room;
	}

	@skipIfClosed
	public async getTenantFromFqdn(clientHost: string): Promise<number> {
		logger.debug({ clientHost }, 'getTenantFromFqdn() - parmas');

		const [ error ] = await this.ready;

		if (error) throw error;

		if (!clientHost) return 0;

		const { total, data } = await this.runAuthenticated(
			() => this.#tenantFQDNsService.find({ query: { fqdn: clientHost.replace(/\.$/, ''), $limit: 1 } })
		);

		logger.debug({ total, data }, 'getTenantFromFqdn() - tenantFQDNsService.find');

		let tenantId = 0;

		if (total === 1 && data[0].tenantId) {
			tenantId = Number(data[0].tenantId);

			logger.debug({ tenantId }, 'getTenantFromFqdn() - got tenantId from management');
		} else {
			logger.debug('getTenantFromFqdn() - no tenantId from management');
		}

		logger.debug({ tenantId }, 'getTenantFromFqdn() - return');

		return tenantId;
	}

	@skipIfClosed
	public async getTenant(tenantId: number): Promise<ManagedTenant | undefined> {
		if (!tenantId) return undefined;

		const [ error ] = await this.ready;

		if (error) throw error;

		try {
			return await this.runAuthenticated(
				() => this.#tenantsService.get(tenantId)
			) as ManagedTenant;
		} catch (err) {
			logger.warn({ err, tenantId }, 'getTenant() failed');

			return undefined;
		}
	}

	@skipIfClosed
	private setupSocketLifecycle(): void {
		logger.debug('setupSocketLifecycle()');

		this.#socket.on('disconnect', (reason) => {
			logger.debug('Socket connection disconnected: %s', reason);

			if (this.closed) return;

			if (reason === 'io server disconnect') {
				this.#client.logout().catch((err) => logger.warn({ err }, 'ensureAuthenticated - io server disconnect.'));
				this.#socket.connect();
			}
		});

		this.#socket.on('connect', () => {
			logger.debug('Socket connected -> ensureAuthenticated()');
			this.ensureAuthenticated()
				.catch((err) => logger.warn({ err }, 'ensureAuthenticated failed on connect.'));
		});

		this.#socket.io.on('reconnect', () => {
			logger.debug('Socket reconnected.');
			this.ensureAuthenticated()
				.catch((err) => logger.warn({ err }, 'ensureAuthenticated failed on reconnect.'));
		});

		this.#socket.io.on('reconnect_attempt', (attempt) => {
			logger.debug('Socket reconnect attempt: %s', attempt);
		});

		this.#socket.io.on('reconnect_error', (err) => {
			logger.debug({ err }, 'Socket reconnect error.');
		});
	}

	@skipIfClosed
	private scheduleTokenRefresh(payload?: { exp?: number; iat?: number }): void {
		if (this.#authRefreshTimer) {
			clearTimeout(this.#authRefreshTimer);
			this.#authRefreshTimer = null;
		}

		if (!payload?.exp) {
			// Token has no exp — we can't compute a refresh time. Don't auto-retry here:
			// either the server is misconfigured (retrying won't help) or it's intentionally
			// non-expiring (no refresh needed). 401 self-heal in runAuthenticated remains as a backstop.
			logger.warn('Token payload missing exp, refresh not scheduled');

			return;
		}

		this.#refreshAttempt = 0;

		const nowSec = Math.floor(Date.now() / 1000);
		const expSec = payload.exp;
		const iatSec = payload.iat ?? nowSec;

		const lifetimeSec = expSec - iatSec;
		const refreshAtSec = iatSec + Math.floor(lifetimeSec * 0.8);

		let delayMs = (refreshAtSec - nowSec) * 1000;

		if (delayMs <= 0)
			delayMs = 1000;

		this.#authRefreshTimer = setTimeout(() => this.runScheduledRefresh(), delayMs);
	}

	@skipIfClosed
	private scheduleRefreshRetry(): void {
		if (this.#authRefreshTimer) {
			clearTimeout(this.#authRefreshTimer);
			this.#authRefreshTimer = null;
		}

		this.#refreshAttempt += 1;

		// First retry is quick — most refresh failures are sub-second blips (socket
		// in mid-reconnect, mgmt restart finishing, transient 5xx) and a 1s retry
		// will land before anyone notices. After that we back off so a real outage
		// doesn't get hammered.
		const backoffSchedule = [ 1_000, 5_000, 30_000, 120_000, 300_000, 600_000 ];
		const idx = Math.min(this.#refreshAttempt - 1, backoffSchedule.length - 1);
		const backoffMs = backoffSchedule[idx];

		logger.warn(
			{ attempt: this.#refreshAttempt, backoffMs },
			'Scheduling token refresh retry'
		);

		this.#authRefreshTimer = setTimeout(() => this.runScheduledRefresh(), backoffMs);
	}

	@skipIfClosed
	private async runScheduledRefresh(): Promise<void> {
		try {
			await this.authenticateLocalDedup();
			// Success path: authenticateLocal -> scheduleTokenRefresh resets #refreshAttempt
			// and re-arms the timer at 80% of the new token's lifetime.
		} catch (err) {
			logger.warn(
				{ err, attempt: this.#refreshAttempt },
				'Token refresh authenticateLocal() failed, will retry with backoff'
			);
			this.scheduleRefreshRetry();
		}
	}

	private authenticateLocalDedup(): Promise<void> {
		if (this.#pendingAuth) return this.#pendingAuth;

		this.#pendingAuth = this.authenticateLocal().finally(() => {
			this.#pendingAuth = null;
		});

		return this.#pendingAuth;
	}

	// Run a mgmt service call; on 401/NotAuthenticated, re-auth once and retry.
	// This is the backstop for the case where the cached token expired between refreshes
	// (e.g. refresh chain broke earlier and recovered too late, or the server invalidated
	// the connection's auth at exp before our refresh landed).
	private async runAuthenticated<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (!isNonRecoverableAuthError(err)) throw err;
			if (this.closed) throw err;

			logger.warn(
				{ err },
				'Management service call got 401; re-authenticating and retrying once'
			);

			try {
				await this.authenticateLocalDedup();
			} catch (authErr) {
				logger.warn(
					{ err: authErr },
					'Re-authentication after 401 failed; rethrowing original error'
				);
				throw err;
			}

			return fn();
		}
	}

	@skipIfClosed
	private async ensureAuthenticated(): Promise<void> {
		logger.debug('ensureAuthenticated()');

		try {
			const authResult = await this.#client.reAuthenticate(true);

			logger.debug('ensureAuthenticated() - reAuthenticate(true) OK');

			const payload = authResult?.authentication?.payload as
				| { exp?: number; iat?: number }
				| undefined;

			this.scheduleTokenRefresh(payload);

			this.resolveReady();

			return;
		} catch (err) {
			logger.debug({ err }, 'reAuthenticate(true) failed, falling back to local auth: %o');
		}

		try {
			await this.authenticateLocal();
			logger.debug('ensureAuthenticated() - authenticateLocal OK');
			this.resolveReady();
		} catch (err) {
			// Reject only on failures that will not heal by reconnecting/retrying.
			if (isNonRecoverableAuthError(err)) {
				this.rejectReady(err);
			}

			throw err;
		}
	}

	@skipIfClosed
	private async authenticateLocal(): Promise<void> {
		logger.debug('authenticateLocal()');

		if (!process.env.MANAGEMENT_USERNAME || !process.env.MANAGEMENT_PASSWORD)
			throw new Error('Management service credentials not configured');

		const authResult = await this.#client.authenticate({
			strategy: 'local',
			email: process.env.MANAGEMENT_USERNAME,
			password: process.env.MANAGEMENT_PASSWORD
		});

		logger.debug('authenticateLocal() - OK');

		const payload = authResult?.authentication?.payload as
			| { exp?: number; iat?: number }
			| undefined;

		this.scheduleTokenRefresh(payload);
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

				const key = String(user.id);
				const set = this.#managedPeers.get(key);

				if (set) {
					for (const peer of set) {
						peer.close();
					}
				}
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
