import { EventEmitter } from 'events';
import { MiddlewareOptions } from '../../../src/common/types';
import { WebRtcTransport } from '../../../src/media/WebRtcTransport';
import MediaService from '../../../src/MediaService';
import { createInitialMediaMiddleware } from '../../../src/middlewares/initialMediaMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';

class MockTransport extends EventEmitter {
	id = 'id';
	iceParameters = 'iceP';
	iceCandidates = 'iceC';
	dtlsParameters = 'dtlsP';
	sctpParameters = 'sctpP';
	connect = jest.fn();
	restartIce = jest.fn();
}

const next = jest.fn();

test('Should not handle wrong session', async () => {
	const room = {
		id: 'id',
		sessionId: SESSION_ID
	};
	const mediaService = {
		getRouter: jest.fn()
	} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {};
	const message = {
		data: {
			sessionId: 'Not this session'
		}
	};
	const context = {
		handled: false,
		peer,
		message
	} as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('getRouterRtpCapabilities() - should get rtpCapabilities', async () => {
	const room = {} as Room;
	const mediaService = {
		getRouter: jest.fn()
	} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: {
			rtpCapabilities: 'rtp' 
		}
	} as unknown as Peer;
	const message = {
		method: 'getRouterRtpCapabilities',
		data: {}
	};
	const context = {
		response: {},
		peer,
		message
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.response.routerRtpCapabilities).toBe('rtp');
	expect(context.handled).toBeTruthy();
});

test('Should get router from mediaService on missing peer router', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const spyGetRouter = jest.fn();
	const mediaService = {
		getRouter: spyGetRouter
	} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: undefined
	} as unknown as Peer;
	const message = {
		data: {
			sessionId: SESSION_ID
		}
	};
	const context = {
		response: {},
		peer,
		message
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyGetRouter).toHaveBeenCalled();
});

test('createWebRtcTransport() - Should throw on no transport', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const options = { room } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: {
			createWebRtcTransport: jest.fn()
		}
	} as unknown as Peer;
	const message = {
		method: 'createWebRtcTransport',
		data: {
			sessionId: SESSION_ID
		}
	};
	const context = {
		peer,
		message
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('createWebRtcTransport() - Should transport life cycle', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const transport = new MockTransport();
	const spyCreateTransport = jest.fn().mockImplementation(() => {
		return transport;
	});
	const mediaService = {} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const spyNotify = jest.fn();
	const peer = {
		router: {
			createWebRtcTransport: spyCreateTransport
		},
		transports: new Map(),
		notify: spyNotify
	} as unknown as Peer;
	const spyDelete = jest.spyOn(peer.transports, 'delete');
	const message = {
		method: 'createWebRtcTransport',
		data: {
			sessionId: SESSION_ID
		}
	};
	const context = {
		response: {},
		peer,
		message
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyCreateTransport).toHaveBeenCalled();
	expect(context.handled).toBeTruthy();
	expect(context.response.id).toBe(transport.id);
	expect(context.response.iceCandidates).toBe(transport.iceCandidates);
	expect(context.response.iceParameters).toBe(transport.iceParameters);
	expect(context.response.dtlsParameters).toBe(transport.dtlsParameters);
	expect(context.response.sctpParameters).toBe(transport.sctpParameters);
	expect(spyNotify).not.toHaveBeenCalled();
	expect(spyDelete).not.toHaveBeenCalled();

	transport.emit('close');

	expect(spyDelete).toHaveBeenCalled();
	expect(spyNotify).toHaveBeenCalled();
	expect(spyNotify.mock.calls[0][0].method).toBe('transportClosed');
});

test('connectWebRtcTransport() - Should connect transport', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const mediaService = {} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: { getRouter: jest.fn() },
		transports: new Map(),
	} as unknown as Peer;
	const transport = new MockTransport() as unknown as WebRtcTransport;
	const spyConnect = jest.spyOn(transport, 'connect');

	peer.transports.set(transport.id, transport);
	const message = {
		method: 'connectWebRtcTransport',
		data: {
			sessionId: SESSION_ID,
			transportId: 'id'
		}
	};
	const context = {
		peer,
		message
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(spyConnect).toHaveBeenCalled();
});

test('connectWebRtcTransport() - Should throw on no transport', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const mediaService = {} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: { getRouter: jest.fn() },
		transports: new Map(),
	} as unknown as Peer;

	const message = {
		method: 'connectWebRtcTransport',
		data: {
			sessionId: SESSION_ID,
			transportId: 'id'
		}
	};
	const context = {
		peer,
		message
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('restartIce() - Should handle ice restart', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const mediaService = {} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: { getRouter: jest.fn() },
		transports: new Map(),
	} as unknown as Peer;

	const message = {
		method: 'restartIce',
		data: {
			sessionId: SESSION_ID,
			transportId: 'id'
		}
	};
	const context = {
		peer,
		message
	} as unknown as PeerContext;

	await expect(sut(context, next)).rejects.toThrow();
});

test('restartIce() - Should throw on no transport', async () => {
	const room = {
		sessionId: SESSION_ID
	} as Room;
	const mediaService = {} as unknown as MediaService;
	const options = { room, mediaService } as MiddlewareOptions;
	const sut = createInitialMediaMiddleware(options);
	const peer = {
		router: { getRouter: jest.fn() },
		transports: new Map(),
	} as unknown as Peer;
	const transport = new MockTransport() as unknown as WebRtcTransport;

	peer.transports.set(transport.id, transport);
	const spyRestartIce = jest.spyOn(transport, 'restartIce').mockImplementation(async () => {
		return 'ice';
	});

	const message = {
		method: 'restartIce',
		data: {
			sessionId: SESSION_ID,
			transportId: 'id'
		}
	};
	const context = {
		peer,
		response: {},
		message
	} as unknown as PeerContext;

	await sut(context, next);

	expect(spyRestartIce).toHaveBeenCalled();
	expect(context.response.iceParameters).toBe('ice');
	expect(context.handled).toBeTruthy();
});