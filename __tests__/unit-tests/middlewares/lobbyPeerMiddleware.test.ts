import { Next } from 'edumeet-common';
import { createLobbyPeerMiddleware } from '../../../src/middlewares/lobbyPeerMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const sut = createLobbyPeerMiddleware({ room });

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

	const sut = createLobbyPeerMiddleware({ room });

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

test('changeDisplayName() - Should notify peers on happy path', async () => {
	const spyNotifyPeers = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		notifyPeersWithPermission: spyNotifyPeers
	} as unknown as Room;

	const sut = createLobbyPeerMiddleware({ room });
	const peer = {
		displayName: ''
	};

	const context = {
		peer,
		message: {
			method: 'changeDisplayName',
			data: {
				displayName: 'n',
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(peer.displayName).toBe('n');
	expect(spyNotifyPeers).toHaveBeenCalled();
});

test('changePicture() - Should notify peers on happy path', async () => {
	const spyNotifyPeers = jest.fn();
	const room = {
		sessionId: SESSION_ID,
		notifyPeersWithPermission: spyNotifyPeers
	} as unknown as Room;

	const sut = createLobbyPeerMiddleware({ room });
	const peer = {
		picture: ''
	};

	const context = {
		peer,
		message: {
			method: 'changePicture',
			data: {
				picture: 'p',
				sessionId: SESSION_ID,
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(peer.picture).toBe('p');
	expect(spyNotifyPeers).toHaveBeenCalled();
});
