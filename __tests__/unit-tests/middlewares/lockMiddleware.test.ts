import { List, Next } from 'edumeet-common';
import { userRoles } from '../../../src/common/authorization';
import { createLockMiddleware } from '../../../src/middlewares/lockMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const sut = createLockMiddleware({ room });

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('Should not handle wrong session', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const sut = createLockMiddleware({ room });

	const context = {
		message: {
			data: {
				sessionId: 'wrong id',
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('lockRoom() - Should throw on not authorized', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const sut = createLockMiddleware({ room });
	const peer = {
		roles: []
	};

	const context = {
		peer,
		message: {
			method: 'lockRoom',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('lockRoom() - Should lock room on happy path', async () => {
	const spyNotifyPeers = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		notifyPeers: spyNotifyPeers,
		locked: false
	} as unknown as Room;

	const sut = createLockMiddleware({ room });
	const peer = {
		roles: [ userRoles.NORMAL ]
	};

	const context = {
		peer,
		message: {
			method: 'lockRoom',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(spyNotifyPeers).toHaveBeenCalled();
	expect(room.locked).toBeTruthy();
});

test('unlockRoom() - Should throw on not authorized', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const sut = createLockMiddleware({ room });
	const peer = {
		roles: []
	};

	const context = {
		peer,
		message: {
			method: 'unlockRoom',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('unlockRoom() - Should unlock room on happy path', async () => {
	const spyNotifyPeers = jest.fn();
	const spyPromoteAllPeers = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		notifyPeers: spyNotifyPeers,
		lobbyPeers: List<Peer>(),
		promoteAllPeers: spyPromoteAllPeers,
		locked: true
	} as unknown as Room;

	const sut = createLockMiddleware({ room });
	const peer = {
		roles: [ userRoles.NORMAL ]
	};

	const context = {
		peer,
		message: {
			method: 'unlockRoom',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	expect(spyPromoteAllPeers).not.toHaveBeenCalled();
	await sut(context, next);

	expect(spyPromoteAllPeers).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
	expect(spyNotifyPeers).toHaveBeenCalled();
	expect(room.locked).toBeFalsy();
});
