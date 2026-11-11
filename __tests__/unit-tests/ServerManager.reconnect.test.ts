import 'jest';
import ServerManager from '../../src/ServerManager';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import ManagementService from '../../src/ManagementService';
import { BaseConnection } from 'edumeet-common';
import { createModeratorMiddleware } from '../../src/middlewares/moderatorMiddleware';
import { PeerContext } from '../../src/Peer';
import { Permission } from '../../src/common/authorization';

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

	return { manager, rooms, roomA, roomB, attacker, peers, connect };
};

// What the room server caches for a participant in a room that revoked nothing.
const participantEntry = { headless: false, botVerified: false, permissionsRevision: 0 };

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

	test('sends roomReady again, not the history, to a peer admitted but not joined, and assigns it a router', () => {
		const { roomB } = setup();
		const pending = new Peer({ id: 'pending', sessionId: roomB.sessionId, reconnectKey: 'pk' });
		const notify = jest.spyOn(pending, 'notify').mockImplementation(() => undefined);
		// eslint-disable-next-line no-unused-vars
		const assignRouter = jest.spyOn(roomB as unknown as { assignRouter: (peer: Peer) => void }, 'assignRouter').mockImplementation(() => undefined);

		roomB.pendingPeers.add(pending);
		roomB.reconnectPeer(pending);
		expect(notify.mock.calls.map(([ m ]) => m.method)).toEqual([ 'roomReady' ]);
		expect(assignRouter).toHaveBeenCalledWith(pending);
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

		const { roomA } = { roomA: manager.rooms.get('7/a') as Room };

		cache(manager).set('mk', { ...participantEntry, roomSession: roomA.sessionId, peerId: 'returning', permissions: [ 'MODERATE_ROOM', 'BYPASS_ROOM_LOCK' ] });
		await connect('returning', 'b', 'mk');

		expect(peers.get('returning')?.permissions).toEqual([]);
		expect(roomB.addPeer).toHaveBeenCalledWith(peers.get('returning'), false);
	});

	test('are not restored in a new meeting opened under the same name', async () => {
		const { manager, rooms, peers, connect } = setup();
		const old = rooms.get('7/a') as Room;

		cache(manager).set('mk', { ...participantEntry, roomSession: old.sessionId, peerId: 'returning', permissions: [ 'MODERATE_ROOM' ] });

		// The old meeting ended; a new one is opened under the same name.
		const reopened = new Room({ id: 'a', tenantId: 7, mediaService: {} as unknown as MediaService });

		reopened.resolveRoomReady();
		jest.spyOn(reopened, 'addPeer').mockResolvedValue(undefined);
		rooms.set('7/a', reopened);

		await connect('returning', 'a', 'mk');

		expect(peers.get('returning')?.permissions).toEqual([]);
		expect(reopened.addPeer).toHaveBeenCalledWith(peers.get('returning'), false);
	});

	test('are not kept for a peer that was kicked', async () => {
		const { manager, rooms, peers, connect } = setup();

		await connect('kicked', 'a', 'kk');

		const kicked = peers.get('kicked') as Peer;

		kicked.permissions = [ 'MODERATE_ROOM' ];
		kicked.admitted = false;
		kicked.close();
		expect(cache(manager).has('kk')).toBe(false);

		await connect('stays', 'a', 'sk');

		const leaving = peers.get('stays') as Peer;

		leaving.permissions = [ 'MODERATE_ROOM' ];
		leaving.admitted = true;
		leaving.close();
		expect(cache(manager).get('sk')).toEqual(expect.objectContaining({ roomSession: (rooms.get('7/a') as Room).sessionId, peerId: 'stays', permissions: [ 'MODERATE_ROOM' ] }));
	});

	test('are not restored for another peer that presents the same key in the same room', async () => {
		const { manager, roomA, peers, connect } = setup();

		cache(manager).set('mk', { ...participantEntry, roomSession: roomA.sessionId, peerId: 'returning', permissions: [ 'MODERATE_ROOM', 'BYPASS_ROOM_LOCK' ] });
		await connect('someone-else', 'a', 'mk');

		expect(peers.get('someone-else')?.permissions).toEqual([]);
		expect(roomA.addPeer).toHaveBeenCalledWith(peers.get('someone-else'), false);
	});

	test('are restored in the room they were held in', async () => {
		const { manager, roomA, peers, connect } = setup();

		cache(manager).set('mk', { ...participantEntry, roomSession: roomA.sessionId, peerId: 'returning', permissions: [ 'MODERATE_ROOM' ] });
		await connect('returning', 'a', 'mk');

		expect(peers.get('returning')?.permissions).toEqual([ 'MODERATE_ROOM' ]);
		expect(roomA.addPeer).toHaveBeenCalledWith(peers.get('returning'), true);
		expect(cache(manager).has('mk')).toBe(false);
	});
});

describe('locking a room', () => {
	test('sends peers admitted but not joined back to the lobby, unless they may pass the lock', () => {
		const { roomB } = setup();
		const admitted = new Peer({ id: 'early', sessionId: roomB.sessionId, reconnectKey: 'ek' });
		const owner = new Peer({ id: 'owner', sessionId: roomB.sessionId, reconnectKey: 'ok' });

		jest.spyOn(admitted, 'notify').mockImplementation(() => undefined);
		jest.spyOn(owner, 'notify').mockImplementation(() => undefined);
		owner.permissions = [ 'BYPASS_ROOM_LOCK' ];
		roomB.pendingPeers.add(admitted);
		roomB.pendingPeers.add(owner);

		admitted.admitted = true;
		const release = jest.spyOn(admitted, 'releaseMedia');

		roomB.locked = false;
		// Any lock parks them, a moderator's or the management service's: both set locked.
		roomB.locked = true;

		expect(roomB.lobbyPeers.items).toEqual([ admitted ]);
		expect(roomB.pendingPeers.items).toEqual([ owner ]);
		expect(admitted.admitted).toBe(false);
		expect(release).toHaveBeenCalled();
	});
});

describe('a room left with only its lobby', () => {
	test('forgets its content also when admitted peers that never joined remain', () => {
		const { roomB, peers } = setup();
		const pending = new Peer({ id: 'pending', sessionId: roomB.sessionId, reconnectKey: 'pk' });

		jest.spyOn(pending, 'notify').mockImplementation(() => undefined);
		roomB.pendingPeers.add(pending);
		roomB.countdownTimer.isStarted = true;

		roomB.removePeer(peers.get('victim') as Peer);

		expect(roomB.closed).toBe(false);
		expect(roomB.chatHistory).toEqual([]);
		expect(roomB.countdownTimer.isStarted).toBe(false);
	});

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

describe('a peer the room removed', () => {
	const cache = (manager: ServerManager) =>
		(manager as unknown as { reconnectPermissionsCache: Map<string, unknown> }).reconnectPermissionsCache;
	const moderatorRights = [ Permission.MODERATE_ROOM, Permission.BYPASS_ROOM_LOCK ];

	// The cache entry expires after two minutes; a real timer would keep Jest from exiting.
	beforeEach(() => jest.useFakeTimers({ doNotFake: [ 'nextTick', 'setImmediate', 'queueMicrotask' ] }));
	afterEach(() => jest.useRealTimers());

	const joinedModerator = async ({ roomA, peers, connect }: ReturnType<typeof setup>) => {
		await connect('mod', 'a', 'mk');

		const mod = peers.get('mod') as Peer;

		jest.spyOn(mod, 'notify').mockImplementation(() => undefined);
		roomA.joinPeer(mod);
		mod.admitted = true;
		mod.permissions = [ ...moderatorRights ];

		return mod;
	};

	test('gets its rights back after a dropped connection', async () => {
		const env = setup();
		const mod = await joinedModerator(env);

		mod.close();
		expect(cache(env.manager).get('mk')).toEqual(expect.objectContaining({ roomSession: env.roomA.sessionId, peerId: 'mod', permissions: moderatorRights }));

		await env.connect('mod', 'a', 'mk');
		expect(env.peers.get('mod')?.permissions).toEqual(moderatorRights);
	});

	test('does not get its rights back after a kick, whatever key its client presents', async () => {
		const env = setup();
		const mod = await joinedModerator(env);

		env.attacker.permissions = [ Permission.MODERATE_ROOM ];

		const context = {
			peer: env.attacker,
			response: {},
			message: { method: 'moderator:kickPeer', data: { peerId: 'mod' } },
		} as unknown as PeerContext;

		await createModeratorMiddleware({ room: env.roomA })(context, jest.fn());

		expect(mod.closed).toBe(true);
		expect(cache(env.manager).has('mk')).toBe(false);

		await env.connect('mod', 'a', 'mk');
		expect(env.peers.get('mod')?.permissions).toEqual([]);
		expect(env.roomA.addPeer).toHaveBeenLastCalledWith(env.peers.get('mod'), false);
	});

	test('does not get its rights back after the meeting was closed', async () => {
		const env = setup();

		await joinedModerator(env);
		env.roomA.close();

		expect(cache(env.manager).has('mk')).toBe(false);
	});

	test('does not get its rights back with a key staged before rejoining and being kicked', async () => {
		const env = setup();
		const mod = await joinedModerator(env);

		// The key 'mk' is cached, then the same peer comes back under another key.
		mod.close();
		expect(cache(env.manager).has('mk')).toBe(true);

		await env.connect('mod', 'a', 'other-key');
		expect(cache(env.manager).has('mk')).toBe(false);

		const rejoined = env.peers.get('mod') as Peer;

		rejoined.admitted = false; // kicked
		rejoined.close();

		await env.connect('mod', 'a', 'mk');
		expect(env.peers.get('mod')?.permissions).toEqual([]);
		expect(env.roomA.addPeer).toHaveBeenLastCalledWith(env.peers.get('mod'), false);
	});

	test('keeps one cache entry per peer', async () => {
		const env = setup();
		const mod = await joinedModerator(env);

		mod.close();
		await env.connect('mod', 'a', 'second-key');

		const again = env.peers.get('mod') as Peer;

		again.admitted = true;
		again.permissions = [ Permission.MODERATE_ROOM ];
		again.close();

		expect([ ...cache(env.manager).keys() ]).toEqual([ 'second-key' ]);
	});

	test('does not get its rights back after the room revoked a right while it was away', async () => {
		const env = setup();
		const mod = await joinedModerator(env);

		mod.close();
		env.roomA.permissionsRevision++;

		await env.connect('mod', 'a', 'mk');
		expect(env.peers.get('mod')?.permissions).toEqual([]);
		expect(env.roomA.addPeer).toHaveBeenLastCalledWith(env.peers.get('mod'), false);
	});

	test('the cache timer of an old entry does not remove a newer one under the same key', async () => {
		const env = setup();
		const mod = await joinedModerator(env);

		mod.close();
		jest.advanceTimersByTime(60_000);

		await env.connect('mod', 'a', 'mk');

		const back = env.peers.get('mod') as Peer;

		back.admitted = true;
		back.close();
		jest.advanceTimersByTime(60_001);

		expect(cache(env.manager).has('mk')).toBe(true);
	});
});

describe('a cached admission is redeemed only by the same kind of peer', () => {
	const cache = (manager: ServerManager) =>
		(manager as unknown as { reconnectPermissionsCache: Map<string, unknown> }).reconnectPermissionsCache;

	test('a verified bot\'s entry does not let a participant in', async () => {
		const { manager, roomA, peers, connect } = setup();

		cache(manager).set('bk', { roomSession: roomA.sessionId, peerId: 'bot', permissions: [ 'BYPASS_ROOM_LOCK' ], headless: true, botVerified: true, permissionsRevision: 0 });
		await connect('bot', 'a', 'bk');

		const peer = peers.get('bot') as Peer;

		expect(peer.headless).toBe(false);
		expect(peer.permissions).toEqual([]);
		expect(roomA.addPeer).toHaveBeenCalledWith(peer, false);
	});
});

describe('authorization revocations', () => {
	test.each([
		'removeRoomOwner', 'removeRoomUserRole', 'removeRoomGroupRole', 'removeGroup', 'removeGroupUser', 'removeRole', 'removeRolePermission',
	])('%s counts as a revocation', async (name) => {
		const authorization = await import('../../src/common/authorization');
		const room = new Room({ id: 'rev', tenantId: 7, mediaService: {} as unknown as MediaService });
		// eslint-disable-next-line no-unused-vars
		const fn = (authorization as unknown as Record<string, (room: Room, arg: unknown) => void>)[name];

		fn(room, { id: 1, userId: 'u', groupId: 'g', roleId: 'r', permission: { id: 1 } });

		expect(room.permissionsRevision).toBe(1);
	});
});
