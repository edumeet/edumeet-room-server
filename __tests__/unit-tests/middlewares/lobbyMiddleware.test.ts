import { List, Next } from 'edumeet-common';
import { userRoles } from '../../../src/common/authorization';
import { MiddlewareOptions } from '../../../src/common/types';
import { createLobbyMiddleware } from '../../../src/middlewares/lobbyMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const sut = createLobbyMiddleware({ room });

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

	const sut = createLobbyMiddleware({ room });

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

test('promotePeer() - Should throw on not authorized', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const peer = {
		roles: []
	};
	const sut = createLobbyMiddleware({ room });

	const context = {
		peer,
		message: {
			method: 'promotePeer',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('promotePeer() - Should throw on peer not found', async () => {
	const room = {
		sessionId: SESSION_ID,
		lobbyPeers: List<Peer>()
	} as unknown as Room;

	const peer = {
		roles: [ userRoles.NORMAL ]
	};
	const sut = createLobbyMiddleware({ room });

	const context = {
		peer,
		message: {
			method: 'promotePeer',
			data: {
				peerId: 'wrong id',
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('promotePeer() - Should promote peer on happy path', async () => {
	const spyPromotePeer = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		lobbyPeers: List<Peer>(),
		promotePeer: spyPromotePeer
	} as unknown as Room;
	const lobbyPeer = {
		id: 'id'
	} as unknown as Peer;

	room.lobbyPeers.add(lobbyPeer);

	const peer = {
		roles: [ userRoles.NORMAL ]
	};
	const sut = createLobbyMiddleware({ room });

	const context = {
		peer,
		message: {
			method: 'promotePeer',
			data: {
				peerId: 'id',
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);
    
	expect(spyPromotePeer).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
});

test('promoteAllPeers() - Should promote peers on happy path', async () => {
	const spyPromoteAllPeers = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		lobbyPeers: List<Peer>(),
		promoteAllPeers: spyPromoteAllPeers
	} as unknown as Room;

	const peer = {
		roles: [ userRoles.NORMAL ]
	};
	const sut = createLobbyMiddleware({ room });

	const context = {
		peer,
		message: {
			method: 'promoteAllPeers',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);
    
	expect(spyPromoteAllPeers).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
});

test('promoteAllPeers() - Should throw on not authorized', async () => {
	const spyPromoteAllPeers = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		lobbyPeers: List<Peer>(),
		promoteAllPeers: spyPromoteAllPeers
	} as unknown as Room;

	const peer = {
		roles: [ ]
	};
	const sut = createLobbyMiddleware({ room });

	const context = {
		peer,
		message: {
			method: 'promoteAllPeers',
			data: {
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});