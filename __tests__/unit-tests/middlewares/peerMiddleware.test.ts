import { createPeerMiddleware } from '../../../src/middlewares/peerMiddleware';
import Room from '../../../src/Room';
import { MiddlewareOptions } from '../../../src/common/types';
import { PeerContext } from '../../../src/Peer';

const next = jest.fn();

test('Should not handle unrelated messages', async () => {
	const room = {} as unknown as Room;
	const sut = createPeerMiddleware({ room });

	const context = {
		handled: false,
		message: {
			method: 'non-existing-method'
		}
	} as PeerContext; 

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('changeDisplayName() - Room should notify peers', async () => {
	const notifyPeers = jest.fn();
	const room = {
		notifyPeers
	} as unknown as Room;
	const sut = createPeerMiddleware({ room });

	const peer = {};
	const context = {
		peer,
		handled: false,
		message: {
			method: 'changeDisplayName',
			data: {
				displayName: 'n'
			}
		}
	} as PeerContext; 

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(notifyPeers).toHaveBeenCalled();
	expect(context.peer.displayName).toBe('n');
});

test('changePicture() - Room should notify peers', async () => {
	const notifyPeers = jest.fn();
	const room = {
		notifyPeers
	} as unknown as Room;
	const sut = createPeerMiddleware({ room });

	const peer = {};
	const context = {
		peer,
		handled: false,
		message: {
			method: 'changePicture',
			data: {
				picture: 'p'
			}
		}
	} as PeerContext; 

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(notifyPeers).toHaveBeenCalled();
	expect(context.peer.picture).toBe('p');
});

test('raisedHand() - Room should notify peers', async () => {
	const notifyPeers = jest.fn();
	const room = {
		notifyPeers
	} as unknown as Room;
	const sut = createPeerMiddleware({ room });

	const peer = {};
	const context = {
		peer,
		handled: false,
		message: {
			method: 'raisedHand',
			data: {
				raisedHand: true
			}
		}
	} as PeerContext; 

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(notifyPeers).toHaveBeenCalled();
	expect(context.peer.raisedHand).toBe(true);
});
