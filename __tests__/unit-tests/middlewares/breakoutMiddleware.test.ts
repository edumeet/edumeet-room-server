import 'jest';
import Room from '../../../src/Room';
import BreakoutRoom from '../../../src/BreakoutRoom';
import { Peer, PeerContext } from '../../../src/Peer';
import MediaService from '../../../src/MediaService';
import { createBreakoutMiddleware } from '../../../src/middlewares/breakoutMiddleware';
import { Permission } from '../../../src/common/authorization';
import { MAX_SESSION_CHANGES_PER_MINUTE } from '../../../src/common/rateLimiter';
import * as suspiciousClients from '../../../src/common/suspiciousClients';
import { MAX_BREAKOUT_ROOMS } from '../../../src/middlewares/breakoutMiddleware';

const next = jest.fn();
const created: Peer[] = [];

const makeRoom = (): Room => new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

const makePeer = (room: Room, over: { headless?: boolean; permissions?: Permission[] } = {}): Peer => {
	const peer = new Peer({ id: `p-${created.length}`, sessionId: room.sessionId, reconnectKey: 'k', headless: over.headless });

	if (over.permissions) peer.permissions = over.permissions;
	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const request = async (room: Room, peer: Peer, method: string, data: Record<string, unknown>): Promise<PeerContext> => {
	const context = { peer, message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

	await createBreakoutMiddleware({ room })(context, next);

	return context;
};

const setup = () => {
	const room = makeRoom();
	const moderator = makePeer(room, { permissions: [ Permission.CREATE_ROOM, Permission.MODERATE_ROOM, Permission.CHANGE_ROOM ] });
	const human = makePeer(room);
	const bot = makePeer(room, { headless: true });
	const breakout = new BreakoutRoom({ parent: room, name: 'b' });

	room.breakoutRooms.set(breakout.sessionId, breakout);
	breakout.once('close', () => room.breakoutRooms.delete(breakout.sessionId));
	room.joinPeer(moderator);
	room.joinPeer(human);
	room.joinPeer(bot);

	for (const p of [ human, bot ]) {
		breakout.addPeer(p);
		p.sessionId = breakout.sessionId;
	}

	return { room, moderator, human, bot, breakout };
};

afterEach(() => {
	jest.clearAllMocks();
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
});

describe('closing a breakout room', () => {
	test('moves the participants back and ends the bots', async () => {
		const { room, moderator, human, bot, breakout } = setup();

		await request(room, moderator, 'removeBreakoutRoom', { roomSessionId: breakout.sessionId });

		expect(human.sessionId).toBe(room.sessionId);
		expect(human.closed).toBe(false);
		expect(bot.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'sessionClosed' } });
		expect(bot.closed).toBe(true);
		expect(room.breakoutRooms.size).toBe(0);
	});

	test('ejecting does the same and keeps the room', async () => {
		const { room, moderator, human, bot, breakout } = setup();

		await request(room, moderator, 'ejectBreakoutRoom', { roomSessionId: breakout.sessionId });

		expect(human.sessionId).toBe(room.sessionId);
		expect(bot.closed).toBe(true);
		expect(breakout.closed).toBe(false);
		expect(breakout.peers.length).toBe(0);
	});
});

describe('a bot in a breakout room', () => {
	test('cannot be moved by a moderator', async () => {
		const { room, moderator, bot } = setup();

		await expect(request(room, moderator, 'moveToBreakoutRoom', { roomSessionId: room.sessionId, roomPeerId: bot.id })).rejects.toThrow('stays in the session');
		expect(bot.sessionId).not.toBe(room.sessionId);
	});

	test('gets no chat handler from the breakout room', async () => {
		const { bot, breakout } = setup();
		const context = { peer: bot, message: { method: 'chatMessage', data: { sessionId: breakout.sessionId, text: 'hi' } }, response: {}, handled: false } as unknown as PeerContext;

		await bot.pipeline.execute(context);

		expect(context.handled).toBe(false);
	});
});

// Each change of session sends the peer the chat and file history of the session it enters.
describe('changes of session', () => {
	test('send the history past connection state recovery when a moderator moves a peer', async () => {
		const { room, moderator, human } = setup();
		const once = jest.spyOn(human, 'notifyOnce').mockImplementation(() => undefined);

		room.chatHistory.push({ peerId: 'x', text: 'hello' } as unknown as Room['chatHistory'][number]);
		await request(room, moderator, 'moveToBreakoutRoom', { roomSessionId: room.sessionId, roomPeerId: human.id });

		expect(once).toHaveBeenCalledWith({
			method: 'sessionIdChanged',
			data: { sessionId: room.sessionId, chatHistory: room.chatHistory, fileHistory: room.fileHistory }
		});
		expect((human.notify as jest.Mock).mock.calls.map(([ m ]) => m.method)).not.toContain('sessionIdChanged');
	});

	test('are refused for a peer a moderator moves back and forth too often', async () => {
		const { room, moderator, human, breakout } = setup();

		jest.spyOn(human, 'notifyOnce').mockImplementation(() => undefined);

		const move = (to: string) => request(room, moderator, 'moveToBreakoutRoom', { roomSessionId: to, roomPeerId: human.id });

		for (let i = 0; i < MAX_SESSION_CHANGES_PER_MINUTE; i++) await move(i % 2 ? breakout.sessionId : room.sessionId);

		const before = human.sessionId;

		await expect(move(before === room.sessionId ? breakout.sessionId : room.sessionId)).rejects.toThrow('Too many session changes');
		expect(human.sessionId).toBe(before);
		expect(human.notifyOnce).toHaveBeenCalledTimes(MAX_SESSION_CHANGES_PER_MINUTE);
	});

	test('are refused for a peer that joins and leaves too often', async () => {
		const { room, moderator, breakout } = setup();

		for (let i = 0; i < MAX_SESSION_CHANGES_PER_MINUTE; i++) {
			if (i % 2) await request(room, moderator, 'leaveBreakoutRoom', {});
			else await request(room, moderator, 'joinBreakoutRoom', { roomSessionId: breakout.sessionId });
		}

		expect(moderator.sessionId).toBe(room.sessionId);
		await expect(request(room, moderator, 'joinBreakoutRoom', { roomSessionId: breakout.sessionId })).rejects.toThrow('Too many session changes');
		expect(moderator.sessionId).toBe(room.sessionId);
		expect(breakout.getPeers()).not.toContain(moderator);
	});

	test('of a peer that used up its own are still open to a moderator, and the other way round', async () => {
		const { room, moderator, human } = setup();

		jest.spyOn(human, 'notifyOnce').mockImplementation(() => undefined);
		human.permissions = [ Permission.CHANGE_ROOM ];
		while (human.sessionChanges.take());

		await expect(request(room, human, 'leaveBreakoutRoom', {})).rejects.toThrow('Too many session changes');
		await request(room, moderator, 'moveToBreakoutRoom', { roomSessionId: room.sessionId, roomPeerId: human.id });
		expect(human.sessionId).toBe(room.sessionId);

		const other = setup();

		jest.spyOn(other.human, 'notifyOnce').mockImplementation(() => undefined);
		other.human.permissions = [ Permission.CHANGE_ROOM ];
		while (other.human.sessionMoves.take());

		await expect(request(other.room, other.moderator, 'moveToBreakoutRoom', { roomSessionId: other.room.sessionId, roomPeerId: other.human.id }))
			.rejects.toThrow('Too many session changes');
		await request(other.room, other.human, 'leaveBreakoutRoom', {});
		expect(other.human.sessionId).toBe(other.room.sessionId);
	});

	test('still move a peer out of a session that closes', async () => {
		const { room, moderator, human, breakout } = setup();

		jest.spyOn(human, 'notifyOnce').mockImplementation(() => undefined);
		while (human.sessionChanges.take());
		while (human.sessionMoves.take());

		await request(room, moderator, 'removeBreakoutRoom', { roomSessionId: breakout.sessionId });
		expect(human.sessionId).toBe(room.sessionId);
	});
});

test('A refused move is reported for the moderator who asked for it, a refused own change for the peer', async () => {
	const { room, moderator, human } = setup();
	const addresses = jest.spyOn(suspiciousClients, 'addressOf').mockImplementation((peer) => `address-of-${peer.id}`);
	const reported = jest.spyOn(suspiciousClients, 'limitHit').mockImplementation(() => undefined);

	try {
		jest.spyOn(human, 'notifyOnce').mockImplementation(() => undefined);
		while (human.sessionMoves.take());
		while (human.sessionChanges.take());

		await expect(request(room, moderator, 'moveToBreakoutRoom', { roomSessionId: room.sessionId, roomPeerId: human.id }))
			.rejects.toThrow('Too many session changes');
		expect(reported).toHaveBeenLastCalledWith(`address-of-${moderator.id}`);

		human.permissions = [ Permission.CHANGE_ROOM ];

		await expect(request(room, human, 'leaveBreakoutRoom', {}))
			.rejects.toThrow('Too many session changes');
		expect(reported).toHaveBeenLastCalledWith(`address-of-${human.id}`);
	} finally {
		addresses.mockRestore();
		reported.mockRestore();
	}
});

test('A room has at most MAX_BREAKOUT_ROOMS breakout rooms', async () => {
	const { room, moderator } = setup();

	while (room.breakoutRooms.size < MAX_BREAKOUT_ROOMS)
		await request(room, moderator, 'createBreakoutRoom', { name: `room ${room.breakoutRooms.size}` });

	await expect(request(room, moderator, 'createBreakoutRoom', { name: 'one more' })).rejects.toThrow('Too many breakout rooms');
	expect(room.breakoutRooms.size).toBe(MAX_BREAKOUT_ROOMS);
});
