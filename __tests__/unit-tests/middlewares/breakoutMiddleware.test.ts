import 'jest';
import Room from '../../../src/Room';
import BreakoutRoom from '../../../src/BreakoutRoom';
import { Peer, PeerContext } from '../../../src/Peer';
import MediaService from '../../../src/MediaService';
import { createBreakoutMiddleware } from '../../../src/middlewares/breakoutMiddleware';
import { Permission } from '../../../src/common/authorization';

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
