import 'jest';
import ServerManager from '../../src/ServerManager';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import ManagementService from '../../src/ManagementService';
import { BaseConnection } from 'edumeet-common';

const makeConnection = () => ({
	id: `c-${Math.random()}`,
	address: { address: '10.0.0.2', forwardedFor: '203.0.113.7' },
	notify: jest.fn(),
	request: jest.fn(),
	close: jest.fn(),
	on: jest.fn(),
	once: jest.fn(),
	removeAllListeners: jest.fn(),
	pipeline: { use: jest.fn(), remove: jest.fn(), execute: jest.fn() },
}) as unknown as BaseConnection & { notify: jest.Mock; close: jest.Mock };

const setup = () => {
	const waiting: (() => void)[] = [];
	const verifyBot = jest.fn(() => new Promise((resolve) => {
		waiting.push(() => resolve({ allowed: true, verified: false }));
	}));
	const managementService = {
		getTenantFromFqdn: jest.fn(async () => 7),
		verifyBot,
	} as unknown as ManagementService;
	const rooms = new Map<string, Room>();
	const peers = new Map<string, Peer>();
	const manager = new ServerManager({
		mediaService: {} as unknown as MediaService,
		peers,
		rooms,
		managedPeers: new Map(),
		managedRooms: new Map(),
		managementService,
	});

	const room = new Room({ id: 'r', tenantId: 7, mediaService: {} as unknown as MediaService });
	const human = new Peer({ id: 'human', sessionId: room.sessionId, reconnectKey: 'hk' });

	jest.spyOn(human, 'notify').mockImplementation(() => undefined);
	room.joinPeer(human);
	room.resolveRoomReady();
	rooms.set('7/r', room);

	const addPeer = jest.spyOn(room, 'addPeer').mockResolvedValue(undefined);

	return { manager, peers, room, addPeer, verifyBot, release: () => waiting.splice(0).forEach((r) => r()) };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
	jest.restoreAllMocks();
});

describe('two connections with the same peerId', () => {
	test.each([ true, false ])('a headless one waiting on verifyBot is refused once the other has registered (second headless: %p)', async (secondHeadless) => {
		const { manager, peers, addPeer, verifyBot, release } = setup();
		const first = makeConnection();
		const second = makeConnection();

		const firstDone = manager.handleConnection(first, 'twin', 'r', 'tenant.example.edu', 'k1', 'A', undefined, undefined, true);

		await tick();
		expect(verifyBot).toHaveBeenCalledTimes(1);

		if (secondHeadless) {
			const secondDone = manager.handleConnection(second, 'twin', 'r', 'tenant.example.edu', 'k2', 'B', undefined, undefined, true);

			await tick();
			release();

			const results = await Promise.allSettled([ firstDone, secondDone ]);

			expect(results.map((r) => r.status).sort()).toEqual([ 'fulfilled', 'rejected' ]);
			expect(addPeer).toHaveBeenCalledTimes(1);
		} else {
			await manager.handleConnection(second, 'twin', 'r', 'tenant.example.edu', 'k2', 'B');

			const registered = peers.get('twin');

			release();
			await expect(firstDone).rejects.toThrow('peerId in use');
			expect(peers.get('twin')).toBe(registered);
			expect(addPeer).toHaveBeenCalledTimes(1);
		}
	});

	test('closing a peer leaves another peer\'s map entry alone', async () => {
		const { manager, peers } = setup();
		const connection = makeConnection();

		await manager.handleConnection(connection, 'p1', 'r', 'tenant.example.edu', 'k1', 'A');

		const first = peers.get('p1') as Peer;
		const intruder = new Peer({ id: 'p1', sessionId: 's', reconnectKey: 'x' });

		peers.set('p1', intruder);
		first.close();

		expect(peers.get('p1')).toBe(intruder);
	});
});

describe('Room', () => {
	test('refuses to add or join a second peer under an id it already holds', async () => {
		const room = new Room({ id: 'r2', tenantId: 0, mediaService: {} as unknown as MediaService });
		const a = new Peer({ id: 'same', sessionId: room.sessionId, reconnectKey: 'a' });
		const b = new Peer({ id: 'same', sessionId: room.sessionId, reconnectKey: 'b' });

		jest.spyOn(a, 'notify').mockImplementation(() => undefined);
		jest.spyOn(b, 'notify').mockImplementation(() => undefined);
		room.joinPeer(a);

		await room.addPeer(b);
		expect(b.closed).toBe(true);
		expect(room.waitingPeers.items).not.toContain(b);

		const c = new Peer({ id: 'same', sessionId: room.sessionId, reconnectKey: 'c' });

		jest.spyOn(c, 'notify').mockImplementation(() => undefined);
		room.joinPeer(c);

		expect(c.closed).toBe(true);
		expect(room.peers.items).toEqual([ a ]);
	});
});
