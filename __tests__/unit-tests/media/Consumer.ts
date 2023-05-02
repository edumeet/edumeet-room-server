import { MediaKind, SocketMessage } from 'edumeet-common';
import 'jest';
import { RtpParameters } from 'mediasoup-client/lib/RtpParameters';
import { ConsumerLayers, ConsumerScore } from '../../../src/common/types';
import { Consumer } from '../../../src/media/Consumer';
import { MediaNodeConnection } from '../../../src/media/MediaNodeConnection';
import { Router } from '../../../src/media/Router';

describe('Consumer', () => {
	const consumerId = 'id'; 
	const producerId = 'id'; 
	let paused: boolean;
	let producerPaused: boolean;
	let fakeRouter: Router;
	let fakeConnection: MediaNodeConnection;
	let fakeAppData: Record<string, unknown>;
	let fakeRtpParameters: RtpParameters;
	let consumer: Consumer;
	let spyEmit: jest.SpyInstance;
	let spyRequest: jest.SpyInstance;
	const SET_LAYERS_METHOD = 'setConsumerPreferredLayers';
	const SET_PRIORITY_METHOD = 'setConsumerPriority';
	const REQUEST_KEY_FRAM_METHOD = 'requestConsumerKeyFrame';
	const TEMPORAL_LAYER = 1;
	const SPATIAL_LAYER = 1;
	const PRIORITY = 1;

	beforeEach(() => {
		fakeRouter = { id: 'id' } as unknown as Router;
		fakeConnection = { 
			once: jest.fn(),
			notify: jest.fn(),
			request: jest.fn(),
			pipeline: {
				use: jest.fn(),
				remove: jest.fn()
			} } as unknown as MediaNodeConnection;
		fakeRtpParameters = {} as unknown as RtpParameters;
		fakeAppData = { 'fake': 'fake' };
		paused = false;
		producerPaused = false;
		consumer = new Consumer({
			id: consumerId,
			kind: MediaKind.VIDEO,
			paused: paused,
			producerPaused: producerPaused,
			rtpParameters: fakeRtpParameters,
			router: fakeRouter,
			connection: fakeConnection,
			appData: fakeAppData,
			producerId: producerId
		});
		spyEmit = jest.spyOn(consumer, 'emit');
		spyRequest = jest.spyOn(consumer.connection, 'request');
	});

	afterAll(() => {
		jest.clearAllMocks();
	});

	it('constructor - AppData should be optional', () => {
		const newConsumer = new Consumer({
			id: consumerId,
			kind: MediaKind.VIDEO,
			paused: paused,
			producerPaused: producerPaused,
			rtpParameters: fakeRtpParameters,
			router: fakeRouter,
			connection: fakeConnection,
			producerId: producerId,
		});

		expect(newConsumer).toBeInstanceOf(Consumer);
		expect(newConsumer.appData).toBeDefined();
	});

	it('close() - Should notify when remote has not closed', () => {
		const spyNotify = jest.spyOn(consumer.connection, 'notify');

		consumer.close();
		expect(spyNotify).toHaveBeenCalled();
	});

	it('setProducerPaused() - Should emit producerpause', () => {
		consumer.setProducerPaused();

		expect(consumer.producerPaused).toBe(true);
		expect(spyEmit).toHaveBeenCalledWith('producerpause');
	});
	
	it('setProducerResumed() - Should emit producerresume', () => {
		consumer.setProducerResumed();

		expect(consumer.producerPaused).toBe(false);
		expect(spyEmit).toHaveBeenCalledWith('producerresume');
	});

	it('setScore() - Should emit score', () => {
		const fakeScore = 'fake' as unknown as ConsumerScore;

		consumer.setScore(fakeScore);
		expect(spyEmit).toHaveBeenCalledWith('score', fakeScore);
	});
	
	it('setLayers() - Should emit layerschange', () => {
		const fakeLayers = 'fake' as unknown as ConsumerLayers;

		consumer.setLayers(fakeLayers);
		expect(spyEmit).toHaveBeenCalledWith('layerschange', fakeLayers);
	});
	
	describe('pause() and resume()', () => {
		let expected: SocketMessage;
		const PAUSE_METHOD = 'pauseConsumer';
		const RESUME_METHOD = 'resumeConsumer';

		beforeEach(() => {
			expected = {
				method: '',
				data: { 
					consumerId: consumer.id,
					routerId: fakeRouter.id 
				}
			};

		});

		it('pause() - Should pause and call request on connection', async () => {
			expect(consumer.paused).toBe(false);

			expected = { ...expected, method: PAUSE_METHOD };

			await consumer.pause();

			expect(spyRequest).toHaveBeenCalledWith(expected);
			expect(consumer.paused).toBe(true);
		});
		
		it('resume() - Should resume and call request on connection ', async () => {
			expect(consumer.paused).toBe(false);

			expected = { ...expected, method: RESUME_METHOD };

			await consumer.resume();

			expect(spyRequest).toHaveBeenCalledWith(expected);
			expect(consumer.paused).toBe(false);
		});
	});

	it('setPreferredLayers() - Should call request on connection', async () => {
		const layers = { spatialLayer: SPATIAL_LAYER, temporalLayer: TEMPORAL_LAYER
		};
		const expected: SocketMessage = { method: SET_LAYERS_METHOD,
			data: { routerId: fakeRouter.id,
				consumerId: consumer.id,
				spatialLayer: SPATIAL_LAYER,
				temporalLayer: TEMPORAL_LAYER }
		};

		await consumer.setPreferredLayers(layers);

		expect(spyRequest).toHaveBeenCalledWith(expected);
	});

	it('setPriority() - Should call request on connection', async () => {
		const expected: SocketMessage = {
			method: SET_PRIORITY_METHOD,
			data: {
				routerId: fakeRouter.id,
				consumerId: consumer.id,
				priority: PRIORITY,
			}
		};

		await consumer.setPriority(PRIORITY);

		expect(spyRequest).toHaveBeenCalledWith(expected);
	});

	it('requestKeyFram() - Should call request on connection', async () => {
		const expected: SocketMessage = {
			method: REQUEST_KEY_FRAM_METHOD,
			data: {
				'consumerId': consumer.id, 'routerId': fakeRouter.id
			}
		};

		await consumer.requestKeyFrame();

		expect(spyRequest).toHaveBeenCalledWith(expected);
	});
});