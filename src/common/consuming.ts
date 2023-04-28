import { Peer } from '../Peer';
import { RouterData } from '../MediaService';
import { Producer } from '../media/Producer';
import { Router } from '../media/Router';
import { Logger } from 'edumeet-common';
import { DataProducer } from '../media/DataProducer';

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
			rtpCapabilities: consumerPeer.rtpCapabilities,
		});

		if (consumerPeer.closed)
			return consumer.close();

		consumerPeer.consumers.set(consumer.id, consumer);

		// The consuming peer went to a different session, maybe close the consumer
		consumerPeer.on('sessionIdChanged', (sessionId) => {
			if (sessionId !== producerPeer.sessionId && !producerPeer.inParent)
				consumer.close();
		});

		// The producing peer went to a different session, maybe close the consumer
		producerPeer.on('sessionIdChanged', (sessionId) => {
			if (sessionId !== consumerPeer.sessionId && !producerPeer.inParent)
				consumer.close();
		});

		consumer.once('close', () => {
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

export const createDataConsumer = async (
	consumerPeer: Peer,
	producerPeer: Peer,
	dataProducer: DataProducer,
): Promise<void> => {
	const { router: producerRouter } = producerPeer;
	const { router: consumerRouter } = consumerPeer;

	if (!producerRouter || !consumerRouter)
		return logger.warn(
			'createDataConsumer() cannot consume [producerPeerId: %s, producerId: %s]',
			producerPeer.id,
			dataProducer.id
		);

	const consumingTransport = Array.from(consumerPeer.transports.values())
		.find((t) => t.appData.consuming);

	if (!consumingTransport)
		return logger.warn('createDataConsumer() transport for consuming not found');

	try {
		// This will wait for the pipe to be ready if it's not already
		await checkDataPipe(dataProducer, consumerRouter, producerRouter);

		const dataConsumer = await consumingTransport.consumeData({
			dataProducerId: dataProducer.id,
		});

		if (consumerPeer.closed)
			return dataConsumer.close();

		consumerPeer.dataConsumers.set(dataConsumer.id, dataConsumer);

		// The consuming peer went to a different session, maybe close the consumer
		consumerPeer.on('sessionIdChanged', (sessionId) => {
			if (sessionId !== producerPeer.sessionId && !producerPeer.inParent)
				dataConsumer.close();
		});

		// The producing peer went to a different session, maybe close the consumer
		producerPeer.on('sessionIdChanged', (sessionId) => {
			if (sessionId !== consumerPeer.sessionId && !producerPeer.inParent)
				dataConsumer.close();
		});

		dataConsumer.once('close', () => {
			consumerPeer.dataConsumers.delete(dataConsumer.id);

			consumerPeer.notify({
				method: 'dataConsumerClosed',
				data: { dataConsumerId: dataConsumer.id }
			});
		});

		consumerPeer.notify({
			method: 'newDataConsumer',
			data: {
				peerId: producerPeer.id,
				dataProducerId: dataConsumer.dataProducerId,
				id: dataConsumer.id,
				sctpStreamParameters: dataConsumer.sctpStreamParameters,
				label: dataConsumer.label,
				protocol: dataConsumer.protocol,
				appData: dataProducer.appData,
			}
		});
	} catch (error) {
		return logger.error('createDataConsumer() [error: %o]', error);
	}
};

const checkPipe = async (
	producer: Producer,
	consumerRouter: Router,
	producerRouter: Router
): Promise<void> => {
	if (consumerRouter !== producerRouter) {
		const { pipePromises } = consumerRouter.appData as unknown as RouterData;

		let pipePromise = pipePromises.get(producer.id);

		if (!pipePromise) {
			logger.debug(
				'createConsumer() pipe producer [producerId: %s]',
				producer.id
			);

			pipePromise = (async () => {
				if (consumerRouter.closed || producerRouter.closed)
					throw new Error('problem with router');

				const {
					pipeProducer,
				} = await producerRouter.pipeToRouter({
					producerId: producer.id,
					router: consumerRouter
				});

				pipeProducer?.once('close', () => pipePromises.delete(producer.id));
			})();

			pipePromises.set(producer.id, pipePromise);
		}

		return pipePromise;
	}
};

const checkDataPipe = async (
	dataProducer: DataProducer,
	consumerRouter: Router,
	producerRouter: Router
): Promise<void> => {
	if (consumerRouter !== producerRouter) {
		const { pipePromises } = consumerRouter.appData as unknown as RouterData;

		let pipePromise = pipePromises.get(dataProducer.id);

		if (!pipePromise) {
			logger.debug(
				'checkDataPipe() pipe dataProducer [producerId: %s]',
				dataProducer.id
			);

			pipePromise = (async () => {
				if (consumerRouter.closed || producerRouter.closed)
					throw new Error('problem with router');

				const {
					pipeDataProducer,
				} = await producerRouter.pipeToRouter({
					dataProducerId: dataProducer.id,
					router: consumerRouter
				});

				pipeDataProducer?.once('close', () => pipePromises.delete(dataProducer.id));
			})();

			pipePromises.set(dataProducer.id, pipePromise);
		}

		return pipePromise;
	}
};