import { SocketMessage } from 'edumeet-common';
import 'jest';
import { SctpStreamParameters } from 'mediasoup-client/lib/SctpParameters';
import { EventEmitter } from 'events';
import { DataConsumer } from '../../../src/media/DataConsumer';
import { MediaNodeConnection } from '../../../src/media/MediaNodeConnection';
import { Router } from '../../../src/media/Router';

class MockConnection extends EventEmitter {
	pipeline = { use: jest.fn(), remove: jest.fn() };
	notify = jest.fn();
}

describe('Consumer', () => {
	const dataConsumerId = 'id'; 
	const dataProducerId = 'id'; 
	let fakeRouter: Router;
	let fakeConnection: MediaNodeConnection;
	let fakeAppData: Record<string, unknown>;
	let fakeSctpStreamParameters: SctpStreamParameters;
	let dataConsumer: DataConsumer;
	let spyNotify: jest.SpyInstance;

	beforeEach(() => {
		fakeConnection = new MockConnection() as unknown as MediaNodeConnection;
		fakeRouter = { id: 'id' } as unknown as Router;
		fakeAppData = { 'fake': 'fake' };
		dataConsumer = new DataConsumer({
			id: dataConsumerId,
			router: fakeRouter,
			connection: fakeConnection,
			appData: fakeAppData,
			sctpStreamParameters: fakeSctpStreamParameters,
			dataProducerId: dataProducerId,
			label: 'label',
			protocol: 'protocol',
		});
		spyNotify = jest.spyOn(dataConsumer.connection, 'notify');
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('constructor - AppData, label and protocol should be optional', () => {
		expect(() => {
			const newConsumer = new DataConsumer({
				id: dataConsumerId,
				router: fakeRouter,
				connection: fakeConnection,
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

	it('Should be closed after close event from connection', () => {
		expect(dataConsumer.closed).toBe(false);
		
		fakeConnection.emit('close');

		expect(dataConsumer.closed).toBe(true);
		expect(spyNotify).not.toHaveBeenCalled();
	});
});