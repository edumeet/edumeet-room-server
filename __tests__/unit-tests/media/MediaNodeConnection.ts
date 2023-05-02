import { BaseConnection, SocketMessage } from 'edumeet-common';
import 'jest';
import { EventEmitter } from 'stream';
import { MediaNodeConnection } from '../../../src/media/MediaNodeConnection';

class MockConnection extends EventEmitter {
	id = 'id';
	request = jest.fn();
	close = jest.fn();
	notify = jest.fn();
}

describe('MediaNodeConnection', () => {
	let mockConnection: BaseConnection;
	let fakeRequest: SocketMessage; 
	let fakeRespond: jest.SpyInstance;  
	let fakeReject: jest.SpyInstance;  

	beforeEach(() => {
		mockConnection = new MockConnection();
		fakeRespond = jest.fn();
		fakeReject = jest.fn();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});
	
	it('notify() - Should call notify on connection', async () => {
		const sut = new MediaNodeConnection({ connection: mockConnection });
		const fakeSocketMessage = {} as unknown as SocketMessage;
		const spyConnectionNotify = jest.spyOn(mockConnection, 'notify');

		sut.notify(fakeSocketMessage);
		await new Promise(process.nextTick);

		expect(spyConnectionNotify).toHaveBeenCalled();
		sut.close();
	});
		
	it('request - Should call reject when not handled by middleware', async () => {
		const sut = new MediaNodeConnection({ connection: mockConnection });

		mockConnection.emit('request', fakeRequest, fakeRespond, fakeReject);
		await new Promise(process.nextTick);
		expect(fakeReject).toHaveBeenCalled();
		expect(fakeRespond).not.toHaveBeenCalled();
		sut.close();
	});
});