import { BaseConnection, SocketMessage } from 'edumeet-common';
import 'jest';
import { EventEmitter } from 'stream';
import { MediaNodeConnection, MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { Pipeline } from 'edumeet-common';

class MockConnection extends EventEmitter {
	id = 'id';
	request = jest.fn();
	close = jest.fn();
	notify = jest.fn();
	// on = jest.fn().mockImplementation(async () => { return true; });
}

describe('MediaNodeConnection', () => {
	let mockConnection: BaseConnection;
	let mediaNodeConnection: MediaNodeConnection;
	let fakeRequest: jest.SpyInstance; 
	let fakeRespond: jest.SpyInstance;  
	let fakeReject: jest.SpyInstance;  
	let spyMediaNodeConnectionClose: jest.SpyInstance;
	let spyEmit: jest.SpyInstance;
	let spyPipelineExecute: jest.SpyInstance;
	const CLOSE_EVENT = 'close';
	const MEDIA_NODE_READY_METHOD = 'mediaNodeReady';
	const OTHER_METHOD = 'method';
	const FAKE_SOCKET_MESSAGE = {} as unknown as SocketMessage;

	beforeEach(() => {
		mockConnection = new MockConnection();
		mediaNodeConnection = new MediaNodeConnection({ connection: mockConnection });
		fakeRequest = jest.fn();
		fakeRespond = jest.fn();
		fakeReject = jest.fn();
		spyMediaNodeConnectionClose = jest.spyOn(mediaNodeConnection.connection, CLOSE_EVENT);
		spyEmit = jest.spyOn(mediaNodeConnection, 'emit');
		spyPipelineExecute = jest.spyOn(mediaNodeConnection.pipeline, 'execute').mockImplementation(async () => { return; });
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('constructor', () => {

		expect(mediaNodeConnection).toBeInstanceOf(MediaNodeConnection);
	});

	it('close() - Should close connection and emit', () => {
		mediaNodeConnection.close();

		expect(mediaNodeConnection.closed).toBe(true);
		expect(spyEmit).toHaveBeenCalledWith(CLOSE_EVENT);
		expect(spyMediaNodeConnectionClose).toHaveBeenCalled();
	});
		
	it('notify() - Should call notify on connection', () => {
		const fakeSocketMessage = {} as unknown as SocketMessage;
		const spyConnectionNotify = jest.spyOn(mockConnection, 'notify');

		mediaNodeConnection.notify(fakeSocketMessage);

		expect(spyConnectionNotify).toHaveBeenCalled();
	});
		
	it('request() - Should call request on connection', () => {
		const spyConnectionRequest = jest.spyOn(mockConnection, 'request');

		mediaNodeConnection.request(FAKE_SOCKET_MESSAGE);

		expect(spyConnectionRequest).toHaveBeenCalled();
	});

	describe('Events', () => {

		it('notification - Should not call execute when method mediaNodeReady', async () => {
			await mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD });
			expect(spyPipelineExecute).not.toHaveBeenCalled();
		});
		
		it('notification - Should call execute when is not method mediaNodeReady', async () => {
			await mockConnection.emit('notification', { method: OTHER_METHOD });
			expect(spyPipelineExecute).toHaveBeenCalled();
		});

		it('request - Should call reject when not handled by middleware', async () => {
			await mockConnection.emit('request', fakeRequest, fakeRespond, fakeReject);
			expect(spyPipelineExecute).toHaveBeenCalled();
			expect(fakeReject).toHaveBeenCalledWith('Server error');
		});
		
		it('request - Should call execute when is not method mediaNodeReady', async () => {
			const pipelineWithMiddleware = {
				execute: (context: MediaNodeConnectionContext) => {
					context.handled = true; 
				}
			} as unknown as Pipeline<MediaNodeConnectionContext>;

			spyPipelineExecute = jest.spyOn(pipelineWithMiddleware, 'execute');

			mediaNodeConnection.pipeline = pipelineWithMiddleware;

			await mockConnection.emit('request', fakeRequest, fakeRespond, fakeReject);
			expect(spyPipelineExecute).toHaveBeenCalled();
			expect(fakeRespond).toHaveBeenCalled();
		});

		it('close - Should call close on connection', async () => {
			await mockConnection.emit('close');
			expect(spyMediaNodeConnectionClose).toHaveBeenCalled();
		});

	});
});