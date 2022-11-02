import { Logger } from './logger';
import { Peer } from '../Peer';
import { RouterData } from '../MediaService';
import { Producer } from '../media/Producer';
import { Router } from '../media/Router';

const logger = new Logger('createConsumer');

export const createConsumer = async (
	consumerPeer: Peer,
	producerPeer: Peer,
	producer: Producer,
): Promise<void> => {
	const { router: producerRouter } = producerPeer;
	const { router: consumerRouter } = consumerPeer;

	if (
		!producerRouter ||
		!consumerRouter ||
		!consumerPeer.rtpCapabilities
	)
		return logger.warn(
			'createConsumer() cannot consume [producerPeerId: %s, producerId: %s]',
			producerPeer.id,
			producer.id
		);

	const canConsume = await producerRouter.canConsume({
		producerId: producer.id,
		rtpCapabilities: consumerPeer.rtpCapabilities
	});

	if (!canConsume)
		return logger.warn(
			'createConsumer() cannot consume [producerPeerId: %s, producerId: %s]',
			producerPeer.id,
			producer.id
		);

	const consumingTransport = Array.from(consumerPeer.transports.values())
		.find((t) => t.appData.consuming);

	if (!consumingTransport)
		return logger.warn('createConsumer() transport for consuming not found');

	try {
		// This will wait for the pipe to be ready if it's not already
		await checkPipe(producer, consumerRouter, producerRouter);

		const consumer = await consumingTransport.consume({
			producerId: producer.id,
			rtpCapabilities: consumerPeer.rtpCapabilities
		});

		if (consumerPeer.closed)
			return consumer.close();

		consumerPeer.consumers.set(consumer.id, consumer);
		consumer.once('close', () => {
			consumer.removeAllListeners();
			consumerPeer.consumers.delete(consumer.id);

			consumerPeer.notify({
				method: 'consumerClosed',
				data: { consumerId: consumer.id }
			});
		});

		consumer.on('producerpause', () => consumerPeer.notify({
			method: 'consumerPaused',
			data: { consumerId: consumer.id }
		}));

		consumer.on('producerresume', () => consumerPeer.notify({
			method: 'consumerResumed',
			data: { consumerId: consumer.id }
		}));

		consumer.on('score', (score) => consumerPeer.notify({
			method: 'consumerScore',
			data: { consumerId: consumer.id, score }
		}));

		consumer.on('layerschange', (layers) => consumerPeer.notify({
			method: 'consumerLayersChanged',
			data: {
				consumerId: consumer.id,
				spatialLayer: layers?.spatialLayer,
				temporalLayer: layers?.temporalLayer
			}
		}));

		consumerPeer.notify({
			method: 'newConsumer',
			data: {
				peerId: producerPeer.id,
				producerId: consumer.producerId,
				id: consumer.id,
				kind: consumer.kind,
				rtpParameters: consumer.rtpParameters,
				producerPaused: consumer.producerPaused,
				appData: producer.appData,
			}
		});
	} catch (error) {
		return logger.error('createConsumer() [error: %o]', error);
	}
};

const checkPipe = async (
	producer: Producer,
	consumerRouter: Router,
	producerRouter: Router
): Promise<void> => {
	if (consumerRouter !== producerRouter) {
		const { pipePromises } = consumerRouter.appData.serverData as RouterData;

		let pipePromise = pipePromises.get(producer.id);

		if (!pipePromise) {
			logger.debug(
				'createConsumer() pipe producer [producerId: %s]',
				producer.id
			);

			pipePromise = new Promise<void>(async (resolve, reject) => {
				if (consumerRouter.closed || producerRouter.closed)
					return reject('problem with router');

				const {
					pipeProducer,
				} = await producerRouter.pipeToRouter({
					producerId: producer.id,
					router: consumerRouter
				});

				pipeProducer?.once('close', () => pipePromises.delete(producer.id));

				return resolve();
			});

			pipePromises.set(producer.id, pipePromise);
		}

		return pipePromise;
	}
};