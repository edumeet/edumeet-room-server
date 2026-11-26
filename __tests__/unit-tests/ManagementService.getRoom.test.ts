import 'jest';
import { BaseConnection } from 'edumeet-common';

// The real ManagementService with a management server that answers from these tables.
type FakeService = { find: jest.Mock; get: jest.Mock; create: jest.Mock; on: jest.Mock };

const mockServices: Record<string, FakeService> = {};

jest.mock('socket.io-client', () => ({
	__esModule: true,
	default: () => ({ on: jest.fn(), io: { on: jest.fn() }, connect: jest.fn(), disconnect: jest.fn() })
}));
jest.mock('@feathersjs/socketio-client', () => ({ __esModule: true, default: () => () => undefined }));
jest.mock('@feathersjs/authentication-client', () => ({ __esModule: true, default: () => () => undefined }));
jest.mock('@feathersjs/feathers', () => {
	const client = {
		configure: () => client,
		service: (name: string) => {
			mockServices[name] ??= {
				find: jest.fn(async () => ({ total: 0, data: [] })),
				get: jest.fn(async () => undefined),
				create: jest.fn(async () => undefined),
				on: jest.fn().mockReturnThis()
			};

			return mockServices[name];
		},
		logout: async () => undefined
	};

	return { feathers: () => client };
});

import ManagementService from '../../src/ManagementService';
import ServerManager from '../../src/ServerManager';
import MediaService from '../../src/MediaService';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';

const TENANT = 7;
const participant = { id: 3, name: 'participant', permissions: [ { id: 1, name: 'SEND_CHAT' } ] };
const presenter = { id: 4, name: 'presenter', permissions: [ { id: 2, name: 'SHARE_SCREEN' } ] };

const closeAfter: Array<{ closed: boolean; close: () => void }> = [];

// rooms: the managed rooms of the tenant by name. defaults: the tenant's defaults row, if any.
const setup = (rooms: Record<string, object>, defaults?: object) => {
	const liveRooms = new Map<string, Room>();
	const peers = new Map<string, Peer>();
	const managementService = new ManagementService({
		managedRooms: new Map(),
		rooms: liveRooms,
		managedPeers: new Map(),
		mediaService: {} as unknown as MediaService
	});

	managementService.resolveReady();
	closeAfter.push(managementService);

	mockServices.tenantFQDNs.find.mockResolvedValue({ total: 1, data: [ { tenantId: TENANT } ] });
	mockServices.rooms.find.mockImplementation(async ({ query }: { query: { name: string } }) => {
		const room = rooms[query.name];

		return room ? { total: 1, data: [ { name: query.name, tenantId: TENANT, owners: [], groupRoles: [], userRoles: [], ...room } ] } : { total: 0, data: [] };
	});
	mockServices.defaults.find.mockResolvedValue(defaults ? { total: 1, data: [ { id: 1, tenantId: TENANT, ...defaults } ] } : { total: 0, data: [] });

	const manager = new ServerManager({
		mediaService: {} as unknown as MediaService,
		peers,
		rooms: liveRooms,
		managedPeers: new Map(),
		managedRooms: new Map(),
		managementService
	});

	// Opens the room as a browser does and says what the participant was told.
	const enter = async (roomId: string): Promise<string[]> => {
		const notify = jest.fn();
		const connection = {
			id: `c-${roomId}`,
			address: { address: '10.0.0.2' },
			notify,
			request: jest.fn(),
			close: jest.fn(),
			on: jest.fn(),
			once: jest.fn(),
			removeAllListeners: jest.fn(),
			pipeline: { use: jest.fn(), remove: jest.fn(), execute: jest.fn() }
		} as unknown as BaseConnection;

		await manager.handleConnection(connection, `peer-${roomId}`, roomId, 'tenant.example.edu', 'key', 'Ada');

		const room = liveRooms.get(`${TENANT}/${roomId}`);
		const peer = peers.get(`peer-${roomId}`);

		if (room) closeAfter.push(room);
		if (peer) closeAfter.push(peer);
		await room?.roomReady;
		// What follows the room's answer runs in the background.
		await new Promise((resolve) => setImmediate(resolve));

		return notify.mock.calls.map(([ notification ]) => notification.method);
	};

	return { managementService, enter };
};

beforeEach(() => {
	// The media side of a join is not part of this.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	jest.spyOn(Room.prototype as any, 'assignRouter').mockResolvedValue(undefined);
});

afterEach(() => {
	for (const item of closeAfter.splice(0)) if (!item.closed) item.close();
	jest.restoreAllMocks();
});

describe('getRoom() and the default role', () => {
	test('a tenant with defaults but no default role gives no role, not an empty list', async () => {
		const { managementService } = setup({ physics: { id: 12 } }, { lockedUnmanaged: false });

		const adHoc = await managementService.getRoom('anything', TENANT);
		const managed = await managementService.getRoom('physics', TENANT);

		expect(adHoc?.defaultRole).toBeUndefined();
		expect(adHoc?.defaultRoleFromTenant).toBe(false);
		expect(managed?.defaultRole).toBeUndefined();
		expect(managed?.defaultRoleFromTenant).toBe(false);
	});

	test('the default role of the tenant applies to ad-hoc rooms and to managed rooms without their own', async () => {
		const { managementService } = setup({ physics: { id: 12 } }, { defaultRoleId: participant.id, defaultRole: participant });

		const adHoc = await managementService.getRoom('anything', TENANT);
		const managed = await managementService.getRoom('physics', TENANT);

		expect(adHoc?.defaultRole).toEqual(participant);
		expect(adHoc?.defaultRoleFromTenant).toBe(true);
		expect(managed?.defaultRole).toEqual(participant);
		expect(managed?.defaultRoleFromTenant).toBe(true);
	});

	test('a managed room keeps its own default role', async () => {
		const { managementService } = setup({ physics: { id: 12, defaultRoleId: presenter.id, defaultRole: presenter } }, { defaultRoleId: participant.id, defaultRole: participant });

		const managed = await managementService.getRoom('physics', TENANT);

		expect(managed?.defaultRole).toEqual(presenter);
		expect(managed?.defaultRoleFromTenant).toBe(false);
	});
});

describe('entering a room of a tenant with defaults but no default role', () => {
	test('an ad-hoc room opens', async () => {
		const { enter } = setup({}, { lockedUnmanaged: false });

		expect(await enter('anything')).toContain('roomReady');
	});

	test('a managed room opens', async () => {
		const { enter } = setup({ physics: { id: 12, locked: false } }, { lockedUnmanaged: false });

		expect(await enter('physics')).toContain('roomReady');
	});

	test('a locked ad-hoc room puts a guest into the lobby', async () => {
		const { enter } = setup({}, { lockedUnmanaged: true });

		expect(await enter('anything')).toContain('enteredLobby');
	});
});
