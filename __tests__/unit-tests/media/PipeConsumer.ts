import 'jest';
import { RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { EventEmitter } from 'events';
import { MediaNodeConnection } from '../../../src/media/MediaNodeConnection';
import { PipeConsumer } from '../../../src/media/PipeConsumer';
import { Router } from '../../../src/media/Router';

import * as PipeConsumerMiddleware from '../../../src/middlewares/pipeConsumerMiddleware';
import { MediaKind } from 'edumeet-common';

class MockMediaNodeConnection extends EventEmitter {
	pipeline = { use: jest.fn(), remove: jest.fn() };
	notify = jest.fn();
}
describe('PipeConsumer', () => {
	let pipeConsumer: PipeConsumer;
	let mockConnection: MediaNodeConnection;
	let fakeRouter: Router;
	let fakeRtpParameters: RtpParameters;
	let spyCreateMW: jest.SpyInstance;
	let spyPipelineRemove: jest.SpyInstance;
	let spyEmit: jest.SpyInstance;
	let spyConnectionNotify: jest.SpyInstance;
	const PIPE_CONSUMER_ID = 'id';
	const PRODUCER_ID = 'id';

	beforeEach(() => {
		fakeRouter = { id: 'id' } as unknown as Router;
		mockConnection = new MockMediaNodeConnection() as unknown as MediaNodeConnection;
		fakeRtpParameters = {} as unknown as RtpParameters;
		spyCreateMW = jest.spyOn(PipeConsumerMiddleware, 'createPipeConsumerMiddleware');
		pipeConsumer = new PipeConsumer({
			id: PIPE_CONSUMER_ID,
			router: fakeRouter,
			connection: mockConnection,
			producerId: PRODUCER_ID,
			kind: MediaKind.VIDEO,
			producerPaused: false,
			rtpParameters: fakeRtpParameters
		});
		spyPipelineRemove = jest.spyOn(mockConnection.pipeline, 'remove');
		spyEmit = jest.spyOn(pipeConsumer, 'emit');
		spyConnectionNotify = jest.spyOn(mockConnection, 'notify');
	});
	afterEach(() => {
		jest.clearAllMocks();
	});

	it('constructor - Should create pipeConsumer middleware', () => {
		expect(spyCreateMW).toHaveBeenCalled();
	});

	it('close() - Should be close PipeConsumer', () => {
		pipeConsumer.close();

		expect(pipeConsumer.closed).toBe(true);
		expect(spyPipelineRemove).toHaveBeenCalled();
		expect(spyEmit).toHaveBeenCalledWith('close');
		expect(spyConnectionNotify).toHaveBeenCalled();
	});

	it('close() - Should not notify connection on remote close', () => {
		const REMOTE_CLOSE = true;

		pipeConsumer.close(REMOTE_CLOSE);

		expect(spyConnectionNotify).not.toHaveBeenCalled();
	});

	it('Should close pipeConsumer on connection close event', () => {
		expect(pipeConsumer.closed).toBe(false);
		mockConnection.emit('close');
		expect(pipeConsumer.closed).toBe(true);
	});
	
	it('setProducerPaused() - Should emit producerpause', () => {
		pipeConsumer.setProducerPaused();

		expect(pipeConsumer.producerPaused).toBe(true);
		expect(spyEmit).toHaveBeenCalledWith('producerpause');
	});
	
	it('setProducerResumed() - Should emit producerresume', () => {
		pipeConsumer.setProducerResumed();

		expect(pipeConsumer.producerPaused).toBe(false);
		expect(spyEmit).toHaveBeenCalledWith('producerresume');
	});
});