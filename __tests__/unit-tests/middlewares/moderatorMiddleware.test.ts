import { List, Next } from 'edumeet-common';
import { MiddlewareOptions } from '../../../src/common/types';
import { Peer, PeerContext } from '../../../src/Peer';
import { createModeratorMiddleware } from '../../../src/middlewares/moderatorMiddleware';
import { userRoles } from '../../../src/common/authorization';
import Room from '../../../src/Room';

const next = jest.fn() as Next;
const SESSION_ID = 'sessionId';
const NON_EXISTING_ROLE_ID = '90019023901293';

afterEach(() => {
	jest.clearAllMocks();
});

test('Should not handle wrong session', async () => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);

	const context = {
		message: {
			data: {
				sessionId: 'wrong session'
			}
		}
	} as PeerContext;

	await sut(context, next);
    
	expect(context.handled).toBeFalsy();
});

test('Should not unrelated messages', async () => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test.each([
	[ 'moderator:giveRole' ],
	[ 'moderator:removeRole' ],
	[ 'moderator:clearChat' ],
	[ 'moderator:clearFiles' ],
	[ 'moderator:mute' ],
	[ 'moderator:muteAll' ],
	[ 'moderator:stopVideo' ],
	[ 'moderator:stopAllVideo' ],
	[ 'moderator:stopScreenSharing' ],
	[ 'moderator:stopAllScreenSharing' ],
	[ 'moderator:closeMeeting' ],
	[ 'moderator:kickPeer' ],
	[ 'moderator:lowerHand' ]
])('Should throw on %s if peer is not a moderator', async (methodToTest) => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);
	const peer = {
		roles: []
	} as unknown as Peer;
	const context = {
		peer,
		message: {
			method: methodToTest,
			data: {
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test.each([
	[ 'moderator:giveRole' ],
	[ 'moderator:removeRole' ],
])('Should throw on non existing role on method %s', async (methodToTest) => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);
	const peer = {
		roles: [ userRoles.NORMAL ]
	} as unknown as Peer;
	const context = {
		peer,
		message: {
			method: methodToTest,
			data: {
				roleId: NON_EXISTING_ROLE_ID,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test.each([
	[ 'moderator:giveRole' ],
	[ 'moderator:removeRole' ],
])('Should throw on non-promotable role on method %s', async (methodToTest) => {
	const room = {
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);
	const peer = {
		roles: [ userRoles.NORMAL ]
	} as unknown as Peer;
	const context = {
		peer,
		message: {
			method: methodToTest,
			data: {
				roleId: userRoles.NORMAL.id,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test.each([
	// [ 'moderator:giveRole' ], only NORMAL can promote peer so can not test this
	// [ 'moderator:removeRole' ], only NORMAL can promote peer so can not test this
	[ 'moderator:mute' ],
	[ 'moderator:stopVideo' ],
	[ 'moderator:stopScreenSharing' ],
	[ 'moderator:kickPeer' ],
	[ 'moderator:lowerHand' ]
])('Should throw on peer not found for %s', async (methodToTest) => {
	const room = {
		sessionId: SESSION_ID,
		peers: List<Peer>()
	} as unknown as Room;
	const options = { room } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);
	const peer = {
		roles: [ userRoles.NORMAL ]
	} as unknown as Peer;
	const context = {
		peer,
		message: {
			method: methodToTest,
			data: {
				peerId: 'non existing',
				roleId: userRoles.PRESENTER.id,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test.each([
	[ 'moderator:clearChat' ],
	[ 'moderator:clearFiles' ],
	[ 'moderator:mute' ],
	[ 'moderator:muteAll' ],
	[ 'moderator:stopVideo' ],
	[ 'moderator:stopAllVideo' ],
	[ 'moderator:stopScreenSharing' ],
	[ 'moderator:stopAllScreenSharing' ],
	[ 'moderator:closeMeeting' ],
	[ 'moderator:kickPeer' ],
	[ 'moderator:lowerHand' ]
])('Should handle happy path for %s', async (methodToTest) => {
	const notifyPeers = jest.fn();
	const spyCloseRoom = jest.fn();
	const room = {
		notifyPeers,
		sessionId: SESSION_ID,
		peers: List<Peer>(),
		close: spyCloseRoom
	} as unknown as Room;
	const notify = jest.fn();
	const spyClosePeer = jest.fn();
	const fakePeer = {
		notify,
		close: spyClosePeer
	} as unknown as Peer;

	room.peers.add(fakePeer);

	const fileHistory = { length: 2 };
	const chatHistory = { length: 2 };
	const options = { room, fileHistory, chatHistory } as MiddlewareOptions;
	const sut = createModeratorMiddleware(options);
	const peer = {
		roles: [ userRoles.NORMAL ]
	} as unknown as Peer;
	const context = {
		peer,
		message: {
			method: methodToTest,
			data: {
				roleId: userRoles.NORMAL.id,
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	if (methodToTest == 'moderator:stopVideo' ||
        methodToTest == 'moderator:stopScreenSharing' || 
        methodToTest == 'moderator:lowerHand') {
		expect(notify.mock.calls[0][0].method).toBe(methodToTest);
	}
	if (methodToTest == 'moderator:clearFiles') {
		expect(notifyPeers.mock.calls[0][0]).toBe(methodToTest);
		expect(fileHistory.length).toBe(0);
	}
	if (methodToTest == 'moderator:clearChat') {
		expect(notifyPeers.mock.calls[0][0]).toBe(methodToTest);
		expect(chatHistory.length).toBe(0);
	}
	if (methodToTest == 'moderator:kickPeer') {
		expect(notify.mock.calls[0][0].method).toBe('moderator:kick');
		expect(spyClosePeer).toHaveBeenCalled();
	}
	if (methodToTest == 'moderator:muteAll') {
		expect(notifyPeers.mock.calls[0][0]).toBe('moderator:mute');
	}
	if (methodToTest == 'moderator:stopAllScreenSharing') {
		expect(notifyPeers.mock.calls[0][0]).toBe('moderator:stopScreenSharing');
	}
	if (methodToTest == 'moderator:muteAllVideo') {
		expect(notifyPeers.mock.calls[0][0]).toBe('moderator:stopVideo');
	}
	if (methodToTest == 'moderator:closeMeeting') {
		expect(notifyPeers.mock.calls[0][0]).toBe('moderator:kick');
		expect(spyCloseRoom).toHaveBeenCalled();
	}
});