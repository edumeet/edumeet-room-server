import 'jest';
import { RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { PipeConsumer } from '../../../src/media/PipeConsumer';
import { Router } from '../../../src/media/Router';
import { MediaKind } from 'edumeet-common';
import MediaNode from '../../../src/media/MediaNode';

describe('PipeConsumer', () => {
	let pipeConsumer: PipeConsumer;
	let fakeRouter: Router;
	let fakeRtpParameters: RtpParameters;
	let spyEmit: jest.SpyInstance;
	let spyNotify: jest.SpyInstance;
	const PIPE_CONSUMER_ID = 'id';
	const PRODUCER_ID = 'id';
	let mediaNode: MediaNode;

	beforeEach(() => {
		spyNotify = jest.fn();
		mediaNode = { notify: spyNotify, once: jest.fn() } as unknown as MediaNode;
		fakeRouter = { id: 'id' } as unknown as Router;
		fakeRtpParameters = {} as unknown as RtpParameters;
		pipeConsumer = new PipeConsumer({
			mediaNode,
			id: PIPE_CONSUMER_ID,
			router: fakeRouter,
			producerId: PRODUCER_ID,
			kind: MediaKind.VIDEO,
			producerPaused: false,
			rtpParameters: fakeRtpParameters
		});
		spyEmit = jest.spyOn(pipeConsumer, 'emit');
	});
	afterEach(() => {
		jest.clearAllMocks();
	});

	it('close() - Should be close PipeConsumer', () => {
		pipeConsumer.close();

		expect(pipeConsumer.closed).toBe(true);
		expect(spyEmit).toHaveBeenCalledWith('close');
		expect(spyNotify).toHaveBeenCalled();
	});

	it('close() - Should not notify connection on remote close', () => {
		pipeConsumer.close(true);

		expect(spyNotify).not.toHaveBeenCalled();
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