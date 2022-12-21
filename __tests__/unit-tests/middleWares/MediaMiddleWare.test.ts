import MediaService from '../../../src/MediaService';
import { ChatMessage, FileMessage } from '../../../src/common/types';
import { createJoinMiddleware } from '../../../src/middlewares/joinMiddleware';
import Room from '../../../src/Room';
import { SocketMessage } from 'edumeet-common';
import { Peer } from '../../../src/Peer';
import * as consuming from '../../../src/common/consuming';
import { createMediaMiddleware } from '../../../src/middlewares/mediaMiddleware';
import { userRoles } from '../../../src/common/authorization';
import { WebRtcTransport } from '../../../src/media/WebRtcTransport';

jest.mock('../../../src/common/consuming');
const spyCreateConsumer = jest.spyOn(consuming, 'createConsumer');

const fakeRoom1 = { 
	sessionId: 'id',
	parent: true,
	getPeers: jest.fn().mockImplementation(() => {
		return [ fakePeerNotAudioOnly ];
	}),
	joinPeer: jest.fn()
} as unknown as Room;
const fakeRoom2 = { 
	sessionId: 'id',
	parent: true,
	getPeers: jest.fn().mockImplementation(() => {
		return [ fakePeerAudioOnly ];
	}),
	joinPeer: jest.fn()
} as unknown as Room;
const fakeMediaService = {} as unknown as MediaService;
const fakeChatHistory = {} as unknown as ChatMessage[];
const fakeFileHistory = {} as unknown as FileMessage[];
const fakeProducer1 = { 
	kind: 'audio', 
	appData: { sessionId: 'id' },
	once: jest.fn(),
	on: jest.fn()
};
const fakeProducer2 = { 
	kind: 'video', 
	appData: { sessionId: 'id' },
	once: jest.fn(),
	on: jest.fn()
};
const fakeWebRtcTransport1 = { 
	produce: () => { return fakeProducer1; } } as unknown as WebRtcTransport;
const fakeWebRtcTransport2 = { 
	produce: () => { return fakeProducer2; } } as unknown as WebRtcTransport;
const	fakePeer1 = {
	roles: [ userRoles.NORMAL ],
	transports: { get: () => { return fakeWebRtcTransport1; } },
	producers: { set: jest.fn() }
} as unknown as Peer;
const	fakePeer2 = {
	roles: [ userRoles.NORMAL ],
	transports: { get: () => { return fakeWebRtcTransport2; } },
	producers: { set: jest.fn() }
} as unknown as Peer;
const fakePeerNotAudioOnly = {
	audioOnly: false 
} as unknown as Peer;
const fakePeerAudioOnly = {
	audioOnly: true
} as unknown as Peer;
const fakeMessage = {
	method: 'produce',
	data: {
		sessionId: 'id', 
		appData: { 
			source: 'webcam' 
		}
	}
} as unknown as SocketMessage;
const fakeResponse = {} as unknown as Record<string, unknown>;
const fakeContext1 = { peer: fakePeer1,
	message: fakeMessage,
	response: fakeResponse,
	handled: false 
};
const fakeContext2 = { peer: fakePeer2,
	message: fakeMessage,
	response: fakeResponse,
	handled: false 
};
const fakeNext = jest.fn();

test('Should call createConsumer() on audio producer', async () => {
	spyCreateConsumer.mockReset();
	const sut = createMediaMiddleware({
		room: fakeRoom1,
		mediaService: fakeMediaService,
		chatHistory: fakeChatHistory,
		fileHistory: fakeFileHistory,
	});

	await sut(fakeContext1, fakeNext);
	expect(spyCreateConsumer).toHaveBeenCalled();
});

test('Should not call createConsumer() on audioOnly consumer and video producer', async () => {
	spyCreateConsumer.mockReset();
	const sut = createMediaMiddleware({
		room: fakeRoom2,
		mediaService: fakeMediaService,
		chatHistory: fakeChatHistory,
		fileHistory: fakeFileHistory,
	});

	await sut(fakeContext2, fakeNext);
	expect(spyCreateConsumer).not.toHaveBeenCalled();
});
