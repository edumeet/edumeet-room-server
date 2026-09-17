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
