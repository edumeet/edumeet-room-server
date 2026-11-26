import 'jest';
import ServerManager from '../../src/ServerManager';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import ManagementService from '../../src/ManagementService';
import { BaseConnection } from 'edumeet-common';
import { addRoomOwner, closeIfReclassified, managedRoomCreated, managedRoomRemoved, sameTenant } from '../../src/common/authorization';
import { ManagedRoom, ManagedRoomOwner } from '../../src/common/types';

const TENANT = 7;

// Everything a test opened is closed after it, so no timer of a room or peer is left running.
const opened: Array<Room | Peer> = [];

const makeConnection = () => ({
	id: `c-${Math.random()}`,
	address: { address: '10.0.0.2' },
	notify: jest.fn(),
	request: jest.fn(),
	close: jest.fn(),
	on: jest.fn(),
	once: jest.fn(),
	removeAllListeners: jest.fn(),
	pipeline: { use: jest.fn(), remove: jest.fn(), execute: jest.fn() },
}) as unknown as BaseConnection;

const managed = (id: number, name: string, tenantId = TENANT) => ({
	id,
	name,
	tenantId,
	description: '',
	owners: [ { id: 1, roomId: String(id), userId: '100' } ],
	groupRoles: [],
	userRoles: [],
	locked: true,
	meetingsOnly: true,
	maxActiveVideos: 12,
}) as unknown as ManagedRoom;

// What the management server knows about the room names of the tenant. A connection opens
// its room from it, as ServerManager.initializeManagedRoom does.
const setup = () => {
	const known = new Map<string, ManagedRoom>();
	const rooms = new Map<string, Room>();
	const managedRooms = new Map<string, Room>();
	const peers = new Map<string, Peer>();
	const manager = new ServerManager({
		mediaService: {} as unknown as MediaService,
		peers,
		rooms,
		managedPeers: new Map(),
		managedRooms,
		managementService: {
			getTenantFromFqdn: jest.fn(async () => TENANT),
			getTenant: jest.fn(async () => undefined),
			getBotProviders: jest.fn(async () => []),
			getRoom: jest.fn(async (name: string) => known.get(name)),
			lookupMeetingToken: jest.fn(),
			reportMeetingActivity: jest.fn(),
		} as unknown as ManagementService,
	});

	// The media side of a join is not part of this: the peer is put into the room directly.
	jest.spyOn(Room.prototype, 'addPeer').mockResolvedValue(undefined);

	const connect = async (peerId: string, roomId: string): Promise<{ room: Room; peer: Peer }> => {
		await manager.handleConnection(makeConnection(), peerId, roomId, 'tenant.example.edu', `key-${peerId}`, peerId);

		const room = rooms.get(`${TENANT}/${roomId}`) as Room;
		const peer = peers.get(peerId) as Peer;

		opened.push(room, peer);

		await room.roomReady;
		jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
		room.joinPeer(peer);

		return { room, peer };
	};

	return { known, rooms, managedRooms, connect };
};

afterEach(() => {
	for (const item of opened.splice(0)) if (!item.closed) item.close();
	jest.restoreAllMocks();
});

describe('a managed room created under the name of a live unmanaged room', () => {
	test('closes that room, and the next connection opens the managed room', async () => {
		const { known, rooms, managedRooms, connect } = setup();

		// Someone opens the name first and stays.
		const { room: held, peer: first } = await connect('first', 'physics');

		expect(held.managedId).toBeUndefined();
		expect(held.locked).toBe(false);

		// The tenant creates the managed room.
		known.set('physics', managed(12, 'physics'));
		expect(managedRoomCreated(rooms, known.get('physics') as ManagedRoom)).toBe(true);

		expect(held.closed).toBe(true);
		expect(first.closed).toBe(true);
		expect(first.notify).toHaveBeenCalledWith({ method: 'escapeMeeting', data: {} });
		expect(rooms.has(`${TENANT}/physics`)).toBe(false);

		// A participant follows the link of the managed room.
		const { room } = await connect('participant', 'physics');

		expect(room).not.toBe(held);
		expect(room.sessionId).not.toBe(held.sessionId);
		expect(room.managedId).toBe('12');
		expect(room.locked).toBe(true);
		expect(room.meetingsOnly).toBe(true);
		expect(room.owners).toEqual([ { id: 1, roomId: '12', userId: '100' } ]);
		expect(managedRooms.get('12')).toBe(room);
	});

	test('without the event the held room would stay: the next connection lands in it', async () => {
		const { known, connect } = setup();
		const { room: held } = await connect('first', 'physics');

		known.set('physics', managed(12, 'physics'));

		const { room } = await connect('participant', 'physics');

		// This is what the listener is for.
		expect(room).toBe(held);
		expect(room.managedId).toBeUndefined();
	});

	test('leaves a room of the same name in another tenant alone', async () => {
		const { rooms, connect } = setup();
		const { room } = await connect('first', 'physics');

		expect(managedRoomCreated(rooms, managed(12, 'physics', TENANT + 1))).toBe(false);
		expect(room.closed).toBe(false);
	});

	test('leaves a room of another name alone', async () => {
		const { rooms, connect } = setup();
		const { room } = await connect('first', 'physics');

		expect(managedRoomCreated(rooms, managed(12, 'chemistry'))).toBe(false);
		expect(room.closed).toBe(false);
	});

	test('leaves a live room alone that was already opened as this managed room', async () => {
		const { known, rooms, connect } = setup();

		known.set('physics', managed(12, 'physics'));

		const { room } = await connect('first', 'physics');

		expect(room.managedId).toBe('12');
		expect(managedRoomCreated(rooms, managed(12, 'physics'))).toBe(false);
		expect(room.closed).toBe(false);
	});
});

describe('a managed room deleted while its meeting is live', () => {
	test('ends the meeting, and nothing is live under its id any more', async () => {
		const { known, rooms, managedRooms, connect } = setup();

		known.set('physics', managed(12, 'physics'));

		const { room: live, peer } = await connect('owner', 'physics');

		expect(managedRooms.get('12')).toBe(live);

		known.delete('physics');
		expect(managedRoomRemoved(managedRooms, { id: 12 })).toBe(true);

		expect(live.closed).toBe(true);
		expect(peer.closed).toBe(true);
		expect(peer.notify).toHaveBeenCalledWith({ method: 'escapeMeeting', data: {} });
		expect(managedRooms.has('12')).toBe(false);
		expect(rooms.has(`${TENANT}/physics`)).toBe(false);

		// An owner added to that id later reaches no meeting. This is what the listeners do
		// with such an event.
		const target = managedRooms.get('12');

		if (target) addRoomOwner(target, { id: 2, roomId: '12', userId: '666' } as ManagedRoomOwner);
		expect(live.owners).toEqual([ { id: 1, roomId: '12', userId: '100' } ]);

		// The name is free again: the next connection opens an unmanaged room.
		const { room } = await connect('next', 'physics');

		expect(room).not.toBe(live);
		expect(room.managedId).toBeUndefined();
	});

	test('does nothing for an id without a live room', () => {
		expect(managedRoomRemoved(new Map(), { id: 12 })).toBe(false);
	});
});

describe('closeIfReclassified', () => {
	const makeRoom = (managedId?: string) => {
		const room = new Room({ id: 'physics', tenantId: TENANT, mediaService: {} as unknown as MediaService });

		room.managedId = managedId;
		opened.push(room);

		return room;
	};

	test.each([
		[ 'unmanaged, still unmanaged', undefined, undefined, false ],
		[ 'managed, still the same room', '12', '12', false ],
		[ 'unmanaged, a managed room has the name now', undefined, '12', true ],
		[ 'managed, the room is gone', '12', undefined, true ],
		[ 'managed, another room has the name now', '12', '13', true ],
	])('%s', (_name, was, is, closes) => {
		const room = makeRoom(was);

		expect(closeIfReclassified(room, is)).toBe(closes);
		expect(room.closed).toBe(closes);
	});

	test('does nothing with a room that is closed already', () => {
		const room = makeRoom();

		room.close();
		expect(closeIfReclassified(room, '12')).toBe(false);
	});
});

describe('sameTenant', () => {
	test('compares the tenant of the live room with that of the event', () => {
		const room = new Room({ id: 'physics', tenantId: TENANT, mediaService: {} as unknown as MediaService });

		opened.push(room);

		expect(sameTenant(room, { tenantId: TENANT })).toBe(true);
		expect(sameTenant(room, { tenantId: String(TENANT) as unknown as number })).toBe(true);
		expect(sameTenant(room, { tenantId: TENANT + 1 })).toBe(false);
		expect(sameTenant(room, {} as unknown as ManagedRoom)).toBe(false);
	});
});
