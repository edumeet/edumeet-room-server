import { BaseConnection, SocketMessage } from 'edumeet-common';
import 'jest';
import { EventEmitter } from 'stream';
import { MediaNodeConnection, MediaNodeConnectionContext } from '../../../src/media/MediaNodeConnection';
import { Pipeline } from 'edumeet-common';
import { setTimeout } from 'timers/promises';

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
	let fakeRequest: SocketMessage; 
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
		fakeRequest = { data: { load: '0.2' } } as unknown as SocketMessage;
		fakeRespond = jest.fn();
		fakeReject = jest.fn();
		spyMediaNodeConnectionClose = jest.spyOn(mediaNodeConnection.connection, CLOSE_EVENT);
		spyEmit = jest.spyOn(mediaNodeConnection, 'emit');
		spyPipelineExecute = jest.spyOn(mediaNodeConnection.pipeline, 'execute').mockImplementation(async () => { return; });
	});

	afterEach(() => {
		jest.clearAllMocks();
		mediaNodeConnection['resolveReady']();
	});

	it('constructor', async () => {
		expect(mediaNodeConnection).toBeInstanceOf(MediaNodeConnection);
		mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
	});

	it('close() - Should close connection and emit', () => {
		mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
		mediaNodeConnection.close();

		expect(mediaNodeConnection.closed).toBe(true);
		expect(spyEmit).toHaveBeenCalledWith(CLOSE_EVENT);
		expect(spyMediaNodeConnectionClose).toHaveBeenCalled();
	});
		
	it('notify() - Should call notify on connection', () => {
		mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
		const fakeSocketMessage = {} as unknown as SocketMessage;
		const spyConnectionNotify = jest.spyOn(mockConnection, 'notify');

		mediaNodeConnection.notify(fakeSocketMessage);

		expect(spyConnectionNotify).toHaveBeenCalled();
	});
		
	it('request() - Should call request on connection', () => {
		mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
		const spyConnectionRequest = jest.spyOn(mockConnection, 'request').mockImplementation(async () => {
			return { load: 0.12 };
		});

		mediaNodeConnection.request(FAKE_SOCKET_MESSAGE);

		expect(spyConnectionRequest).toHaveBeenCalled();
	});

	describe('Events', () => {

		it('notification - Should not call execute when method mediaNodeReady', () => {
			mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
			expect(spyPipelineExecute).not.toHaveBeenCalled();
		});
		
		it('notification - Should call execute when is not method mediaNodeReady', () => {
			mockConnection.emit('notification', { method: OTHER_METHOD, data: { load: 0.2 } });
			expect(mediaNodeConnection.load).toBe(0.2);
			expect(spyPipelineExecute).toHaveBeenCalled();
			mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
		});

		it('request - Should call reject when not handled by middleware', async () => {
			mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
			mockConnection.emit('request', fakeRequest, fakeRespond, fakeReject);
			await setTimeout(200);
			expect(fakeReject).toHaveBeenCalledWith('Server error');
			expect(spyPipelineExecute).toHaveBeenCalled();
		});
		
		it('request - Should call execute when is not method mediaNodeReady', async () => {
			const pipelineWithMiddleware = {
				execute: (context: MediaNodeConnectionContext) => {
					context.handled = true; 
				}
			} as unknown as Pipeline<MediaNodeConnectionContext>;

			spyPipelineExecute = jest.spyOn(pipelineWithMiddleware, 'execute');

			mediaNodeConnection.pipeline = pipelineWithMiddleware;

			mockConnection.emit('request', fakeRequest, fakeRespond, fakeReject);
			await setTimeout(100);
			expect(fakeRespond).toHaveBeenCalled();
			expect(spyPipelineExecute).toHaveBeenCalled();
			mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
		});

		it('close - Should call close on connection', () => {
			mockConnection.emit('notification', { method: MEDIA_NODE_READY_METHOD, data: { load: '0.2' } });
			mockConnection.emit('close');
			expect(spyMediaNodeConnectionClose).toHaveBeenCalled();
		});

	});
});