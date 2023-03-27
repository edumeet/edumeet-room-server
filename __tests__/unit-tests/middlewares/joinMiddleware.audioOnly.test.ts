import MediaService from '../../../src/MediaService';
import { ChatMessage, FileMessage } from '../../../src/common/types';
import { createJoinMiddleware } from '../../../src/middlewares/joinMiddleware';
import Room from '../../../src/Room';
import { SocketMessage } from 'edumeet-common';
import { Peer } from '../../../src/Peer';
import * as consuming from '../../../src/common/consuming';

jest.mock('../../../src/common/consuming');
const spyCreateConsumer = jest.spyOn(consuming, 'createConsumer');

const fakeRoom1 = { 
	sessionId: 'id',
	parent: true,
	getPeers: jest.fn().mockImplementation(() => {
		return [ fakeAudioPeer ];
	}),
	joinPeer: jest.fn()
} as unknown as Room;
const fakeRoom2 = { 
	sessionId: 'id',
	parent: true,
	getPeers: jest.fn().mockImplementation(() => {
		return [ fakeAudioOnlyPeer ];
	}),
	joinPeer: jest.fn()
} as unknown as Room;
const fakeMediaService = {} as unknown as MediaService;
const fakeChatHistory = {} as unknown as ChatMessage[];
const fakeFileHistory = {} as unknown as FileMessage[];

const	fakePeer1 = {
	roles: [],
	audioOnly: true
} as unknown as Peer;
const	fakeAudioPeer = {
	roles: [],
	producers: [ { closed: false, kind: 'audio', appData: { sessionId: 'id' } } ],
	dataProducers: []
} as unknown as Peer;
const	fakeAudioOnlyPeer = {
	roles: [],
	producers: [ { closed: false, kind: 'video', appData: { sessionId: 'id' } } ],
	dataProducers: []
} as unknown as Peer;
const fakeMessage = { method: 'join', data: { sessionId: 'id' } } as unknown as SocketMessage;
const fakeResponse = {} as unknown as Record<string, unknown>;
const fakeContext = { peer: fakePeer1,
	message: fakeMessage,
	response: fakeResponse,
	handled: false };
const fakeNext = jest.fn();

test('Should call createConsumer() on audio producer', () => {
	spyCreateConsumer.mockReset();
	const sut = createJoinMiddleware({
		room: fakeRoom1,
		mediaService: fakeMediaService,
		chatHistory: fakeChatHistory,
		fileHistory: fakeFileHistory,
	});

	sut(fakeContext, fakeNext);
	expect(spyCreateConsumer).toHaveBeenCalled();
});

test('Should not call createConsumer() on audioOnly peer and video producer ', () => {
	spyCreateConsumer.mockReset();
	const sut = createJoinMiddleware({
		room: fakeRoom2,
		mediaService: fakeMediaService,
		chatHistory: fakeChatHistory,
		fileHistory: fakeFileHistory,
	});

	sut(fakeContext, fakeNext);
	expect(spyCreateConsumer).not.toHaveBeenCalled();
});