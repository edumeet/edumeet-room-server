import { MiddlewareOptions } from '../../../src/common/types';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import * as checkSessionId from '../../../src/common/checkSessionId';
import { createBreakoutMiddleware } from '../../../src/middlewares/breakoutMiddleware';
import { List } from 'edumeet-common';
import { userRoles } from '../../../src/common/authorization';

const next = jest.fn();
const SESSION_ID = 'sessionId';

afterEach(() => {
	jest.clearAllMocks();
});

test('joinRoom() - Should throw on room not found', async () => {
	const room = {
		id: 'id',
		rooms: List<Room>(),
		sessionId: SESSION_ID
	} as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createBreakoutMiddleware(options);

	const peer = { roles: [] };
	const message = { 
		method: 'joinRoom',
		data: {
			sessionId: SESSION_ID
		} };

	const context = {
		peer,
		message,
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('joinRoom() - Should call addPeer on breakoutRoom', async () => {
	const spyAddPeer = jest.fn();
	const breakOutRoomToJoin = { id: SESSION_ID, addPeer: spyAddPeer } as unknown as Room;
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		rooms: List<Room>(),
	} as unknown as Room;

	room.rooms.add(breakOutRoomToJoin);
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createBreakoutMiddleware(options);

	const peer = { roles: [] };
	const message = {
		method: 'joinRoom',
		data: {
			sessionId: SESSION_ID
		}
	};
	const context = {
		peer,
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyAddPeer).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
});

test('Should call next middleware on wrong session', async () => {
	const spyThisSession = jest.spyOn(checkSessionId, 'thisSession');
	const room = { sessionId: 'id1' } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createBreakoutMiddleware(options);

	const message = { data: { sessionId: 'id2' } };

	const context = {
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyThisSession).toHaveBeenCalled();
	expect(context.handled).toBeFalsy();
});

test('Should not handle unrelated methods', async () => {
	const room = { id: 'id' } as unknown as Room;
	const options = { room } as unknown as MiddlewareOptions;
	const sut = createBreakoutMiddleware(options);

	const message = {};

	const context = {
		message,
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('createRoom() - Should throw when peer not authorized', async () => {
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		rooms: List<Room>(),
	} as unknown as Room;

	const options = { room } as unknown as MiddlewareOptions;
	const sut = createBreakoutMiddleware(options);

	const peer = { roles: [] };
	const message = {
		method: 'createRoom',
		data: {
			sessionId: SESSION_ID
		}
	};
	const context = {
		peer,
		message,
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('createRoom() - Should add room and notify peers', async () => {
	const addRoom = jest.fn();
	const notifyPeers = jest.fn();
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		rooms: List<Room>(),
		addRoom,
		notifyPeers
	} as unknown as Room;

	const options = { room } as unknown as MiddlewareOptions;
	const sut = createBreakoutMiddleware(options);

	const peer = { roles: [ userRoles.NORMAL ] };
	const message = {
		method: 'createRoom',
		data: {
			name: 'name',
			sessionId: SESSION_ID
		}
	};
	const context = {
		peer,
		message,
		response: {},
		handled: false
	} as unknown as PeerContext;

	await sut(context, next);

	expect(addRoom).toHaveBeenCalled();
	expect(notifyPeers).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
});
