import 'jest';

import { DataProducer } from '../../../src/media/DataProducer';
import { Router } from '../../../src/media/Router';
import MediaNode from '../../../src/media/MediaNode';
import { SctpStreamParameters } from 'mediasoup/types';

describe('DataProducer', () => {
	const DATA_PRODUCER_ID = 'id';
	let fakeSctpStreamParameters: SctpStreamParameters;
	let fakeAppData: Record<string, unknown>;
	let dataProducer: DataProducer;
	let fakeRouter: Router;
	let spyNotify: jest.SpyInstance;
	let mediaNode: MediaNode;

	beforeEach(() => {
		fakeSctpStreamParameters = { streamId: 0 };
		fakeAppData = {};		
		fakeRouter = {} as unknown as Router;
		spyNotify = jest.fn();
		mediaNode = { notify: spyNotify, once: jest.fn() } as unknown as MediaNode;
		dataProducer = new DataProducer({
			mediaNode,
			sctpStreamParameters: fakeSctpStreamParameters,
			appData: fakeAppData,
			id: DATA_PRODUCER_ID,
			router: fakeRouter,
		});
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('constructor - label, protocol and appData should be optional', () => {
		dataProducer = new DataProducer({
			mediaNode,
			sctpStreamParameters: fakeSctpStreamParameters,
			router: fakeRouter,
			id: DATA_PRODUCER_ID,
		});

		expect(dataProducer).toBeInstanceOf(DataProducer);
	});

	it('close() - Should not notify on remote close', () => {
		const remoteClose = true;

		dataProducer.close(remoteClose);
		
		expect(spyNotify).not.toHaveBeenCalled();
		expect(dataProducer.closed).toBe(true);
	});
});