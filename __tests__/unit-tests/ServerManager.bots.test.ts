import 'jest';
import ServerManager from '../../src/ServerManager';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import ManagementService from '../../src/ManagementService';
import BreakoutRoom from '../../src/BreakoutRoom';
import { BaseConnection } from 'edumeet-common';

type Verdict = { allowed: true; verified: boolean } | { allowed: false; reason: string };

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

const setup = ({ tenantId = 7, verdict }: { tenantId?: number; verdict?: Verdict } = {}) => {
	const verifyBot = jest.fn(async () => verdict ?? { allowed: true, verified: false });
	const managementService = {
		getTenantFromFqdn: jest.fn(async () => tenantId),
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

	const openRoom = (): Room => {
		const room = new Room({ id: 'r', tenantId, mediaService: {} as unknown as MediaService });
		const human = new Peer({ id: 'human', sessionId: room.sessionId, reconnectKey: 'hk' });

		jest.spyOn(human, 'notify').mockImplementation(() => undefined);
		jest.spyOn(room, 'addPeer').mockResolvedValue(undefined);
		room.joinPeer(human);
		rooms.set(`${tenantId}/r`, room);

		return room;
	};

	const connectBot = (connection = makeConnection(), botToken?: string, botType?: string, botSession?: string) =>
		manager.handleConnection(connection, `bot-${Math.random()}`, 'r', 'tenant.example.edu', 'rk', 'Recorder', undefined, undefined, true, botToken, botType, botSession);

	return { manager, rooms, peers, verifyBot, openRoom, connectBot };
};

afterEach(() => {
	jest.restoreAllMocks();
});

describe('a headless connection', () => {
	test('is refused while the room is not open, and opens no room', async () => {
		const { rooms, peers, connectBot, verifyBot } = setup();
		const connection = makeConnection();

		await connectBot(connection);

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'roomNotOpen' } });
		expect(connection.close).toHaveBeenCalledTimes(1);
		expect(rooms.size).toBe(0);
		expect(peers.size).toBe(0);
		expect(verifyBot).not.toHaveBeenCalled();
	});

	test('is refused when only bots are left in the room', async () => {
		const { rooms, connectBot } = setup();
		const room = new Room({ id: 'r', tenantId: 7, mediaService: {} as unknown as MediaService });
		const bot = new Peer({ id: 'other-bot', sessionId: room.sessionId, reconnectKey: 'bk', headless: true });

		jest.spyOn(bot, 'notify').mockImplementation(() => undefined);
		room.joinPeer(bot);
		rooms.set('7/r', room);

		const connection = makeConnection();

		await connectBot(connection);

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'roomNotOpen' } });
	});

	test('asks the management server with the tenant, the token and the client address', async () => {
		const { openRoom, connectBot, verifyBot } = setup({ verdict: { allowed: true, verified: true } });

		openRoom();
		await connectBot(makeConnection(), 'secret');

		expect(verifyBot).toHaveBeenCalledWith({ tenantId: 7, botToken: 'secret', address: '203.0.113.7' });
	});

	test('is refused with the management server\'s reason', async () => {
		const { openRoom, connectBot, peers } = setup({ verdict: { allowed: false, reason: 'botTokenRejected' } });
		const connection = makeConnection();

		openRoom();
		await connectBot(connection, 'wrong');

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'botTokenRejected' } });
		expect(connection.close).toHaveBeenCalledTimes(1);
		expect(peers.size).toBe(0);
	});

	test('becomes a verified bot with its type when the management server says so', async () => {
		const { openRoom, connectBot, peers } = setup({ verdict: { allowed: true, verified: true } });
		const room = openRoom();

		await connectBot(makeConnection(), 'secret', 'recorder');

		const bot = [ ...peers.values() ][0];

		expect(bot.headless).toBe(true);
		expect(bot.botVerified).toBe(true);
		expect(bot.botType).toBe('recorder');
		expect(room.addPeer).toHaveBeenCalledWith(bot, false);
	});

	test('becomes a generic bot under the all-bots policy and drops an unknown type', async () => {
		const { openRoom, connectBot, peers } = setup({ verdict: { allowed: true, verified: false } });

		openRoom();
		await connectBot(makeConnection(), undefined, 'toaster');

		const bot = [ ...peers.values() ][0];

		expect(bot.headless).toBe(true);
		expect(bot.botVerified).toBe(false);
		expect(bot.botType).toBeUndefined();
	});

	test('skips the management server outside a tenant and joins as a generic bot', async () => {
		const { openRoom, connectBot, peers, verifyBot } = setup({ tenantId: 0 });

		openRoom();
		await connectBot(makeConnection(), 'secret');

		expect(verifyBot).not.toHaveBeenCalled();
		expect([ ...peers.values() ][0].botVerified).toBe(false);
	});
});

describe('a headless connection while the management service gives no answer', () => {
	test('is refused rather than admitted', async () => {
		const { openRoom, connectBot, peers, verifyBot } = setup();
		const connection = makeConnection();

		verifyBot.mockResolvedValueOnce(undefined as never);
		openRoom();
		await connectBot(connection, 'secret');

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'botsNotAllowed' } });
		expect(peers.size).toBe(0);
	});
});

describe('a headless connection whose room closes while the management server is asked', () => {
	test('is refused instead of being left hanging', async () => {
		const { openRoom, connectBot, peers, verifyBot } = setup();
		const room = openRoom();
		const connection = makeConnection();

		verifyBot.mockImplementationOnce(async () => {
			room.close();

			return { allowed: true, verified: true };
		});

		await connectBot(connection, 'secret');

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'roomNotOpen' } });
		expect(connection.close).toHaveBeenCalledTimes(1);
		expect(peers.size).toBe(0);
	});
});

describe('a headless connection naming a breakout session', () => {
	test('is refused when no such breakout room exists', async () => {
		const { openRoom, connectBot, peers } = setup({ verdict: { allowed: true, verified: true } });
		const connection = makeConnection();

		openRoom();
		await connectBot(connection, 'secret', 'recorder', 'no-such-session');

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'sessionNotOpen' } });
		expect(peers.size).toBe(0);
	});

	test('carries the session on the peer when the breakout room exists, even empty', async () => {
		const { openRoom, connectBot, peers } = setup({ verdict: { allowed: true, verified: true } });
		const room = openRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'b' });

		room.breakoutRooms.set(breakout.sessionId, breakout);
		await connectBot(makeConnection(), 'secret', 'recorder', breakout.sessionId);

		expect([ ...peers.values() ][0].botSessionId).toBe(breakout.sessionId);
	});
});

describe('a bot that comes for a job', () => {
	const jobId = '5b2f1c1e-0000-4000-8000-000000000000';
	const recorder = { credentialId: 7, label: 'Acme Recorder', jobType: 'recorder' as const, apiUrl: 'https://rec.example.com', apiSecret: 'key' };
	const verified = { allowed: true as const, verified: true, credentialId: 7, jobType: 'recorder' };

	const connectJobBot = (manager: ServerManager, botType = 'recorder', id = jobId) => {
		const connection = makeConnection();

		return manager.handleConnection(connection, `bot-${Math.random()}`, 'r', 'tenant.example.edu', 'rk', 'Recorder', undefined, undefined, true, 'secret', botType, undefined, id)
			.then(() => connection);
	};

	test('is let in with its job when the key is the provider\'s', async () => {
		const { manager, openRoom, peers } = setup({ verdict: verified as Verdict });
		const room = openRoom();

		room.botProviders = [ recorder ];
		await connectJobBot(manager);

		const bot = [ ...peers.values() ].find((p) => p.headless);

		expect(bot?.jobId).toBe(jobId);
		expect(room.botJobs.active).toEqual([ expect.objectContaining({ id: jobId, state: 'starting' }) ]);
	});

	test('comes in as a plain bot when the key belongs to no provider of the room', async () => {
		const { manager, openRoom, peers } = setup({ verdict: verified as Verdict });

		openRoom();
		await connectJobBot(manager);

		expect([ ...peers.values() ].find((p) => p.headless)?.jobId).toBeUndefined();
	});

	test('is refused when its kind is not the kind its key is for', async () => {
		const { manager, openRoom, peers } = setup({ verdict: verified as Verdict });

		openRoom().botProviders = [ recorder ];

		const connection = await connectJobBot(manager, 'transcriber');

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'botTokenRejected' } });
		expect([ ...peers.values() ].some((p) => p.headless)).toBe(false);
	});

	test('is refused for a job that is over', async () => {
		const { manager, openRoom } = setup({ verdict: verified as Verdict });
		const room = openRoom();

		room.botProviders = [ recorder ];
		room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' });
		room.botJobs.stop(jobId);

		const connection = await connectJobBot(manager);

		expect(connection.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'jobNotActive' } });
	});

	test('carries no job when the tenant did not vouch for it', async () => {
		const { manager, openRoom, peers } = setup({ verdict: { allowed: true, verified: false } });

		openRoom().botProviders = [ recorder ];
		await connectJobBot(manager);

		expect([ ...peers.values() ].find((p) => p.headless)?.jobId).toBeUndefined();
	});
});

describe('a room server that shuts down', () => {
	test('lets go of the bot jobs before anything closes, so they are left with their providers', () => {
		const { manager, openRoom, peers } = setup();
		const room = openRoom();
		const order: string[] = [];

		jest.spyOn(room.botJobs, 'close').mockImplementation((options) => { order.push(options?.keepJobs ? 'jobs kept' : 'jobs stopped'); });
		jest.spyOn(room.peers.items[0], 'close').mockImplementation(() => { order.push('peer'); });

		(manager as unknown as { mediaService: { close: () => void } }).mediaService = { close: jest.fn() };

		peers.set('human', room.peers.items[0]);
		manager.close();

		expect(order.slice(0, 2)).toEqual([ 'jobs kept', 'peer' ]);
	});
});

describe('the providers of a new room', () => {
	const openBy = async (tenantId: number) => {
		const getBotProviders = jest.fn(async () => [ { credentialId: 7, label: 'Acme', jobType: 'recorder', apiUrl: 'https://rec.example.com', apiSecret: 'key' } ]);
		const managementService = {
			getTenantFromFqdn: jest.fn(async () => tenantId),
			getTenant: jest.fn(async () => undefined),
			getRoom: jest.fn(async () => undefined),
			getBotProviders,
		} as unknown as ManagementService;
		const rooms = new Map<string, Room>();
		const manager = new ServerManager({
			mediaService: {} as unknown as MediaService,
			peers: new Map(),
			rooms,
			managedPeers: new Map(),
			managedRooms: new Map(),
			managementService,
		});

		jest.spyOn(Room.prototype, 'addPeer').mockResolvedValue(undefined);
		await manager.handleConnection(makeConnection(), 'human', 'r', 'tenant.example.edu', 'rk', 'Anna');

		const room = rooms.get(`${tenantId}/r`) as Room;

		await room.roomReady;

		return { room, getBotProviders };
	};

	test('are read once for a room of a tenant', async () => {
		const { room, getBotProviders } = await openBy(7);

		expect(getBotProviders).toHaveBeenCalledTimes(1);
		expect(getBotProviders).toHaveBeenCalledWith(7);
		expect(room.botProviders).toHaveLength(1);
	});

	test('are not asked for a room that belongs to no tenant', async () => {
		const { room, getBotProviders } = await openBy(0);

		expect(getBotProviders).not.toHaveBeenCalled();
		expect(room.botProviders).toEqual([]);
	});
});

describe('what a new room learns from its tenant', () => {
	test('its language, and a way to look up the addresses of its people', async () => {
		const getBotRecipients = jest.fn(async () => [ { email: 'a@example.org' } ]);
		const managementService = {
			getTenantFromFqdn: jest.fn(async () => 7),
			getTenant: jest.fn(async () => ({ id: 7, name: 't', locale: 'pl' })),
			getRoom: jest.fn(async () => undefined),
			getBotProviders: jest.fn(async () => []),
			getBotRecipients,
		} as unknown as ManagementService;
		const rooms = new Map<string, Room>();
		const manager = new ServerManager({
			mediaService: {} as unknown as MediaService,
			peers: new Map(),
			rooms,
			managedPeers: new Map(),
			managedRooms: new Map(),
			managementService,
		});

		jest.spyOn(Room.prototype, 'addPeer').mockResolvedValue(undefined);
		await manager.handleConnection(makeConnection(), 'human', 'r', 'tenant.example.edu', 'rk', 'Anna');

		const room = rooms.get('7/r') as Room;

		await room.roomReady;

		expect(room.locale).toBe('pl');
		expect(await room.resolveBotRecipients?.([ '1', '2' ])).toEqual([ { email: 'a@example.org' } ]);
		expect(getBotRecipients).toHaveBeenCalledWith(7, [ '1', '2' ]);
	});
});
