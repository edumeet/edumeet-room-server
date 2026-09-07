import { List, Next } from 'edumeet-common';
import { createJoinMiddleware } from '../../../src/middlewares/joinMiddleware';
import { Permission } from '../../../src/common/authorization';
import { Peer, PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';
const next = jest.fn() as unknown as Next;

const waiting = (id: string): Peer => ({ id, peerInfo: { id, displayName: id } }) as unknown as Peer;

const setup = (permissions: Permission[]) => {
	const lobbyPeers = List<Peer>();

	lobbyPeers.add(waiting('a'), waiting('b'), waiting('c'));

	const room = {
		sessionId: SESSION_ID,
		lobbyPeers,
		chatHistory: [],
		fileHistory: [],
		countdownTimer: {},
		drawing: {},
		locked: true,
		getPeers: () => [],
		getBreakoutRooms: () => [],
		joinPeer: jest.fn(),
	} as unknown as Room;
	const peer = {
		id: 'joiner',
		permissions,
		hasPermission: (p: Permission) => permissions.includes(p),
		initialConsume: false,
		consumingTransport: undefined,
	} as unknown as Peer;
	const context = {
		peer,
		message: { method: 'join', data: { sessionId: SESSION_ID, displayName: 'Owner' } },
		response: {},
		handled: false,
	} as unknown as PeerContext;

	return { room, peer, context, sut: createJoinMiddleware({ room }) };
};

test('A room owner joining a locked room with people in the lobby is handed all of them in the join response', async () => {
	const { room, context, sut } = setup([ Permission.BYPASS_ROOM_LOCK, Permission.PROMOTE_PEER ]);

	await sut(context, next);

	expect(context.handled).toBe(true);
	expect(room.joinPeer).toHaveBeenCalledWith(context.peer);
	expect(context.response.lobbyPeers).toEqual([
		{ id: 'a', displayName: 'a' }, { id: 'b', displayName: 'b' }, { id: 'c', displayName: 'c' },
	]);
});

test('A joiner without the promote permission is told nothing about the lobby', async () => {
	const { context, sut } = setup([ Permission.BYPASS_ROOM_LOCK ]);

	await sut(context, next);

	expect(context.handled).toBe(true);
	expect(context.response.lobbyPeers).toEqual([]);
});
