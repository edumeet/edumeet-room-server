import 'jest';
import { SctpStreamParameters } from 'mediasoup-client/lib/SctpParameters';
import { EventEmitter } from 'stream';
import { DataProducer } from '../../../src/media/DataProducer';
import { MediaNodeConnection } from '../../../src/media/MediaNodeConnection';
import { Router } from '../../../src/media/Router';

class MockConnection extends EventEmitter {
	pipeline = { use: jest.fn(), remove: jest.fn() };
	notify = jest.fn();
}

describe('DataProducer', () => {
	const DATA_PRODUCER_ID = 'id';
	let fakeSctpStreamParameters: SctpStreamParameters;
	let fakeAppData: Record<string, unknown>;
	let dataProducer: DataProducer;
	let fakeRouter: Router;
	let fakeConnection: MediaNodeConnection;
	let spyNotify: jest.SpyInstance;
	const CLOSE_METHOD = 'closeDataProducer';

	beforeEach(() => {
		fakeSctpStreamParameters = {};
		fakeAppData = {};		
		fakeRouter = {} as unknown as Router;
		fakeConnection = new MockConnection() as unknown as MediaNodeConnection;
		dataProducer = new DataProducer({
			sctpStreamParameters: fakeSctpStreamParameters,
			appData: fakeAppData,
			id: DATA_PRODUCER_ID,
			router: fakeRouter,
			connection: fakeConnection
		});
		spyNotify = jest.spyOn(fakeConnection, 'notify');
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it('constructor - label, protocol and appData should be optional', () => {
		dataProducer = new DataProducer({
			sctpStreamParameters: fakeSctpStreamParameters,
			router: fakeRouter,
			connection: fakeConnection,
			id: DATA_PRODUCER_ID,
		});

		expect(dataProducer).toBeInstanceOf(DataProducer);
	});

	it('close() - Should be closed and notify connection', () => {
		const spyRemove = jest.spyOn(fakeConnection.pipeline, 'remove');
		const expected = { method: CLOSE_METHOD,
			data: {
				routerId: fakeRouter.id,
				dataProducerId: dataProducer.id,
			}
		};

		dataProducer.close();
		expect(dataProducer.closed).toBe(true);
		expect(spyRemove).toHaveBeenCalled();
		expect(spyNotify).toHaveBeenCalledWith(expected);
	});

	it('close() - Should not notify on remote close', () => {
		const remoteClose = true;

		dataProducer.close(remoteClose);
		
		expect(spyNotify).not.toHaveBeenCalled();
		expect(dataProducer.closed).toBe(true);
	});
});