import { List, MediaKind } from 'edumeet-common';
import { userRoles } from '../../../src/common/authorization';
import { MiddlewareOptions } from '../../../src/common/types';
import { DataProducer } from '../../../src/media/DataProducer';
import { Producer } from '../../../src/media/Producer';
import { createJoinMiddleware } from '../../../src/middlewares/joinMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

import * as consuming from '../../../src/common/consuming';

const next = jest.fn();
const SESSION_ID = 'sessionId';

afterEach(() => {
	jest.clearAllMocks();
});

test('Should not handle unrelated message', async () => {
	const room = {
		sessionId: SESSION_ID,
	} as unknown as Room;

	const options = { room } as MiddlewareOptions;
	const sut = createJoinMiddleware(options);

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
		id: 'id',
		sessionId: SESSION_ID
	};
	const options = { room } as MiddlewareOptions;
	const sut = createJoinMiddleware(options);

	const context = {
		message: {
			method: 'join',
			data: {
				sessionId: 'other ID'
			}
		}
	} as PeerContext;

	await sut(context, next);
});

test('join() - Should throw on missing rtpCapabilities', async () => {
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		parent: false
	} as unknown as Room;
	const options = { room } as MiddlewareOptions;
	const sut = createJoinMiddleware(options);

	const context = {
		message: {
			method: 'join',
			data: {
				sessionId: SESSION_ID
			}
		}
	} as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('join() - Should join peer', async () => {
	const spyCreateConsumer = jest.spyOn(consuming, 'createConsumer')
		.mockImplementation(async () => { return; });
	const spyCreateDataConsumer = jest.spyOn(consuming, 'createDataConsumer')
		.mockImplementation(async () => { return; });
	const fakePeer = {
		peerInfo: 'getPeer',
		sessionId: SESSION_ID,
		inParent: true,
		producers: new Map<string, Producer>(),
		dataProducers: new Map<string, DataProducer>(),
	};
	const fakeProducer = {
		id: 'id',
		kind: MediaKind.VIDEO
	} as unknown as Producer;
	const fakeDataProducer = {
		id: 'id',
	} as unknown as DataProducer;

	fakePeer.producers.set(fakeProducer.id, fakeProducer);
	fakePeer.dataProducers.set(fakeDataProducer.id, fakeDataProducer);
	const spyGetPeers = jest.fn().mockImplementation(() => {
		return [ fakePeer ];
	});
	const spyJoinPeer = jest.fn();
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		parent: false,
		getPeers: spyGetPeers,
		lobbyPeers: List<Peer>(),
		joinPeer: spyJoinPeer,
		locked: true
	} as unknown as Room;
	const lobbyPeer = { peerInfo: 'lobbyPeer' } as unknown as Peer;

	room.lobbyPeers.add(lobbyPeer);
	const options = { room } as MiddlewareOptions;
	const sut = createJoinMiddleware(options);

	const peer = {
		displayName: '',
		picture: '',
		rtpCapabilities: '',
		roles: [ userRoles.NORMAL ],
		sessionId: SESSION_ID,
		inParent: true,
	} as unknown as Peer;
	const context = {
		peer,
		response: {},
		message: {
			method: 'join',
			data: {
				sessionId: SESSION_ID,
				displayName: 'n',
				picture: 'p',
				rtpCapabilities: 'rtp'
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(peer.displayName).toBe(context.message.data.displayName);
	expect(peer.picture).toBe(context.message.data.picture);
	expect(peer.rtpCapabilities).toBe(context.message.data.rtpCapabilities);
	expect(context.handled).toBeTruthy();
	expect(context.response.lobbyPeers).toEqual([ lobbyPeer.peerInfo ]);
	expect(context.response.locked).toBeTruthy();
	expect(spyGetPeers).toHaveBeenCalled();
	expect(spyJoinPeer).toHaveBeenCalled();
	expect(spyCreateConsumer).toHaveBeenCalled();
	expect(spyCreateDataConsumer).toHaveBeenCalled();
});

test('join() - Should not return lobbyPeers on missing permission', async () => {
	const spyGetPeers = jest.fn().mockImplementation(() => {
		return [];
	});
	const spyJoinPeer = jest.fn();
	const room = {
		id: 'id',
		sessionId: SESSION_ID,
		parent: false,
		getPeers: spyGetPeers,
		joinPeer: spyJoinPeer,
		locked: false
	} as unknown as Room;
	const options = { room } as MiddlewareOptions;
	const sut = createJoinMiddleware(options);

	const peer = {
		displayName: '',
		picture: '',
		rtpCapabilities: '',
		roles: []
	} as unknown as Peer;
	const context = {
		peer,
		response: {},
		message: {
			method: 'join',
			data: {
				sessionId: SESSION_ID,
				rtpCapabilities: 'rtp'
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(context.response.lobbyPeers).toEqual([]);
	expect(context.response.locked).toBeFalsy();
	expect(spyGetPeers).toHaveBeenCalled();
	expect(spyJoinPeer).toHaveBeenCalled();
});
