import { SocketMessage } from 'edumeet-common';
import 'jest';
import { DataConsumer } from '../../../src/media/DataConsumer';
import { Router } from '../../../src/media/Router';
import MediaNode from '../../../src/media/MediaNode';
import { SctpStreamParameters } from 'mediasoup/types';

describe('Consumer', () => {
	const dataConsumerId = 'id'; 
	const dataProducerId = 'id'; 
	let fakeRouter: Router;
	let fakeAppData: Record<string, unknown>;
	let fakeSctpStreamParameters: SctpStreamParameters;
	let dataConsumer: DataConsumer;
	let spyNotify: jest.SpyInstance;
	let mediaNode: MediaNode;

	beforeEach(() => {
		fakeRouter = { id: 'id' } as unknown as Router;
		fakeAppData = { 'fake': 'fake' };
		spyNotify = jest.fn();
		mediaNode = { notify: spyNotify, once: jest.fn() } as unknown as MediaNode;
		dataConsumer = new DataConsumer({
			mediaNode,
			id: dataConsumerId,
			router: fakeRouter,
			appData: fakeAppData,
			sctpStreamParameters: fakeSctpStreamParameters,
			dataProducerId: dataProducerId,
			label: 'label',
			protocol: 'protocol',
		});
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('constructor - AppData, label and protocol should be optional', () => {
		expect(() => {
			const newConsumer = new DataConsumer({
				id: dataConsumerId,
				router: fakeRouter,
				mediaNode,
				sctpStreamParameters: fakeSctpStreamParameters,
				dataProducerId: dataProducerId
			}); 

			expect(newConsumer).toBeInstanceOf(DataConsumer);
		}).not.toThrow();
	});

	it('close() - Should notify when remoteClose is false', () => {
		const expected: SocketMessage = {
			method: 'closeDataConsumer',
			data: {
				routerId: fakeRouter.id,
				dataConsumerId: dataConsumer.id,
			}
		};

		dataConsumer.close(false);
		expect(spyNotify).toHaveBeenCalledWith(expected);
	});
});