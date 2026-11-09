import 'jest';
import ServerManager from '../../src/ServerManager';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import ManagementService from '../../src/ManagementService';
import { BaseConnection } from 'edumeet-common';

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

// The attacker's peer is in room A; the victim's room B has chat history.
const setup = () => {
	const tenantId = 7;
	const rooms = new Map<string, Room>();
	const peers = new Map<string, Peer>();
	const manager = new ServerManager({
		mediaService: {} as unknown as MediaService,
		peers,
		rooms,
		managedPeers: new Map(),
		managedRooms: new Map(),
		managementService: { getTenantFromFqdn: jest.fn(async () => tenantId) } as unknown as ManagementService,
	});

	const makeRoom = (id: string) => {
		const room = new Room({ id, tenantId, mediaService: {} as unknown as MediaService });

		room.resolveRoomReady();
		rooms.set(`${tenantId}/${id}`, room);
		jest.spyOn(room, 'addPeer').mockResolvedValue(undefined);
		jest.spyOn(room, 'reconnectPeer');

		return room;
	};
	const makePeer = (room: Room, id: string, reconnectKey: string) => {
		const peer = new Peer({ id, sessionId: room.sessionId, reconnectKey });

		jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
		jest.spyOn(peer, 'switchConnection').mockImplementation(() => undefined);
		room.joinPeer(peer);
		peers.set(id, peer);

		return peer;
	};

	const roomA = makeRoom('a');
	const roomB = makeRoom('b');

	roomB.chatHistory.push({ peerId: 'victim', text: 'secret' } as unknown as Room['chatHistory'][number]);

	const attacker = makePeer(roomA, 'attacker', 'ak');

	makePeer(roomB, 'victim', 'vk');

	const connect = (peerId: string, roomId: string, reconnectKey: string) =>
		manager.handleConnection(makeConnection(), peerId, roomId, 'tenant.example.edu', reconnectKey, 'Name');

	return { manager, roomA, roomB, attacker, peers, connect };
};

afterEach(() => {
	jest.restoreAllMocks();
});

describe('reconnect', () => {
	test('is refused into a room the peer is not in', async () => {
		const { roomB, attacker, connect } = setup();

		await expect(connect('attacker', 'b', 'ak')).rejects.toThrow('Invalid reconnectKey');
		expect(roomB.reconnectPeer).not.toHaveBeenCalled();
		expect(attacker.switchConnection).not.toHaveBeenCalled();
	});

	test('is refused into a room that does not exist, like any wrong room', async () => {
		const { attacker, connect } = setup();

		await expect(connect('attacker', 'nonexistent', 'ak')).rejects.toThrow('Invalid reconnectKey');
		expect(attacker.closed).toBe(false);
	});

	test('is accepted into the own room', async () => {
		const { roomA, attacker, connect } = setup();

		await connect('attacker', 'a', 'ak');
		expect(attacker.switchConnection).toHaveBeenCalled();
		expect(roomA.reconnectPeer).toHaveBeenCalledWith(attacker);
	});

	test('sends no room state to a peer that is still being checked', () => {
		const { roomB } = setup();
		const waiting = new Peer({ id: 'waiting', sessionId: roomB.sessionId, reconnectKey: 'wk' });
		const notify = jest.spyOn(waiting, 'notify').mockImplementation(() => undefined);

		roomB.waitingPeers.add(waiting);
		roomB.reconnectPeer(waiting);
		expect(notify).not.toHaveBeenCalled();
	});
});

describe('cached permissions of a slow reconnect', () => {
	const cache = (manager: ServerManager) =>
		(manager as unknown as { reconnectPermissionsCache: Map<string, unknown> }).reconnectPermissionsCache;

	test('are not restored in another room, and the meeting token is still checked', async () => {
		const { manager, roomB, peers, connect } = setup();

		cache(manager).set('mk', { roomKey: '7/a', permissions: [ 'MODERATE_ROOM', 'BYPASS_ROOM_LOCK' ] });
		await connect('returning', 'b', 'mk');

		expect(peers.get('returning')?.permissions).toEqual([]);
		expect(roomB.addPeer).toHaveBeenCalledWith(peers.get('returning'), false);
	});

	test('are restored in the room they were held in', async () => {
		const { manager, roomA, peers, connect } = setup();

		cache(manager).set('mk', { roomKey: '7/a', permissions: [ 'MODERATE_ROOM' ] });
		await connect('returning', 'a', 'mk');

		expect(peers.get('returning')?.permissions).toEqual([ 'MODERATE_ROOM' ]);
		expect(roomA.addPeer).toHaveBeenCalledWith(peers.get('returning'), true);
		expect(cache(manager).has('mk')).toBe(false);
	});
});

describe('a room left with only its lobby', () => {
	test('forgets chat, files and whiteboard when the last participant leaves', () => {
		const { roomB, peers } = setup();
		const victim = peers.get('victim') as Peer;
		const waiting = new Peer({ id: 'lobby', sessionId: roomB.sessionId, reconnectKey: 'lk' });

		jest.spyOn(waiting, 'notify').mockImplementation(() => undefined);
		roomB.lobbyPeers.add(waiting);
		roomB.fileHistory.push({} as Room['fileHistory'][number]);
		roomB.drawing.canvasState.push({} as never);

		roomB.removePeer(victim);

		expect(roomB.closed).toBe(false);
		expect(roomB.chatHistory).toEqual([]);
		expect(roomB.fileHistory).toEqual([]);
		expect(roomB.drawing.canvasState).toEqual([]);
	});
});

describe('a connection that closes during the tenant lookup', () => {
	test('leaves no peer and no room behind', async () => {
		const rooms = new Map<string, Room>();
		const peers = new Map<string, Peer>();
		const connection = makeConnection() as BaseConnection & { closed?: boolean };
		const manager = new ServerManager({
			mediaService: {} as unknown as MediaService,
			peers,
			rooms,
			managedPeers: new Map(),
			managedRooms: new Map(),
			managementService: {
				getTenantFromFqdn: jest.fn(async () => {
					connection.closed = true;

					return 7;
				})
			} as unknown as ManagementService,
		});

		await manager.handleConnection(connection, 'gone', 'fresh-room', 'tenant.example.edu', 'gk', 'Name');

		expect(peers.size).toBe(0);
		expect(rooms.size).toBe(0);
	});
});
