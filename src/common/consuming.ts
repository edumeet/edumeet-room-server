import { Peer } from '../Peer';
import { RouterData } from '../MediaService';
import { Producer } from '../media/Producer';
import { Router } from '../media/Router';
import { Logger } from 'edumeet-common';
import { DataProducer } from '../media/DataProducer';
import Room from '../Room';
import { LayerWatcher } from './layerWatcher';
import { LayerReporter } from './layerReporter';

const logger = new Logger('createConsumer');

export const createConsumers = async (
	room: Room,
	consumerPeer: Peer,
): Promise<[] | unknown[]> => {
	// Peers in the same session as the consumerPeer
	const peers = room.getPeers(consumerPeer).filter((p) => p.sameSession(consumerPeer));

	const createConsumerPromises: Promise<void>[] = [];

	for (const producerPeer of peers) {
		for (const producer of producerPeer.producers.values()) {
			createConsumerPromises.push(createConsumer(consumerPeer, producerPeer, producer));
		}
	}

	const createDataConsumerPromises: Promise<void>[] = [];

	for (const producerPeer of peers) {
		for (const dataProducer of producerPeer.dataProducers.values()) {
			createDataConsumerPromises.push(createDataConsumer(consumerPeer, producerPeer, dataProducer));
		}
	}

	return Promise.all([
		...createConsumerPromises,
		...createDataConsumerPromises,
	]);
};

export const createConsumer = async (
	consumerPeer: Peer,
	producerPeer: Peer,
	producer: Producer,
): Promise<void> => {
	const [ consumerError, consumerRouter ] = await consumerPeer.routerReady;
	const [ producerError, producerRouter ] = await producerPeer.routerReady;

	if (producerError || consumerError || !consumerPeer.rtpCapabilities)
		return logger.warn(
			'createConsumer() cannot consume [producerPeerId: %s, producerId: %s]',
			producerPeer.id,
			producer.id
		);

	const canConsume = producerRouter.canConsume({
		producerId: producer.id,
		rtpCapabilities: consumerPeer.rtpCapabilities
	});

	if (!canConsume)
		return logger.warn(
			'createConsumer() cannot consume [producerPeerId: %s, producerId: %s]',
			producerPeer.id,
			producer.id
		);

	const consumingTransport = consumerPeer.consumingTransport;

	if (!consumingTransport)
		return logger.warn('createConsumer() transport for consuming not found');

	try {
		// This will wait for the pipe to be ready if it's not already
		await checkPipe(producer, consumerRouter, producerRouter);

		const consumer = await consumingTransport.consume({
			producerId: producer.id,
			rtpCapabilities: consumerPeer.rtpCapabilities,
		});

		if (consumer.kind === 'video')
			consumer.appData.layerReporter = (producer.appData.layerWatcher as LayerWatcher).createLayerReporter();

		if (consumerPeer.closed) return consumer.close();

		// If the consuming peer went to a different session, maybe close the consumer
		if (!consumerPeer.sameSession(producerPeer)) return consumer.close();

		consumerPeer.consumers.set(consumer.id, consumer);

		logger.debug({
			consumerId: consumer.id,
			consumerPeerId: consumerPeer.id,
			consumerPeerName: consumerPeer.displayName,
			producerPeerId: producerPeer.id,
			producerPeerName: producerPeer.displayName,
			kind: consumer.kind,
			producerId: consumer.producerId
		}, 'created consumer');

		// The consuming peer went to a different session, maybe close the consumer
		consumerPeer.on('sessionIdChanged', () => {
			if (!consumerPeer.sameSession(producerPeer)) consumer.close();
		});

		// The producing peer went to a different session, maybe close the consumer
		producerPeer.on('sessionIdChanged', () => {
			if (!consumerPeer.sameSession(producerPeer)) consumer.close();
		});

		consumer.once('close', () => {
			consumerPeer.consumers.delete(consumer.id);
			(consumer.appData.layerReporter as LayerReporter)?.close();

			consumerPeer.notify({
				method: 'consumerClosed',
				data: { consumerId: consumer.id }
			});
		});

		consumer.on('producerpause', () => {
			logger.debug({
				consumerId: consumer.id,
				consumerPeerId: consumerPeer.id,
				consumerPeerName: consumerPeer.displayName,
				producerPeerId: producerPeer.id,
				producerPeerName: producerPeer.displayName,
				kind: consumer.kind,
				producerId: consumer.producerId
			}, 'notify consumerPaused');

			consumerPeer.notify({
				method: 'consumerPaused',
				data: { consumerId: consumer.id }
			});
		});

		// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
		const { appData: { layerWatcher, ...producerAppData } } = producer;

		consumer.on('producerresume', () => {
			if (consumer.appData.suspended) {
				logger.debug({
					consumerId: consumer.id,
					consumerPeerId: consumerPeer.id,
					consumerPeerName: consumerPeer.displayName,
					producerPeerId: producerPeer.id,
					producerPeerName: producerPeer.displayName,
					kind: consumer.kind,
					producerId: consumer.producerId
				}, 'producerresume -> notify newConsumer (unsuspend)');

				consumerPeer.notify({
					method: 'newConsumer',
					data: {
						peerId: producerPeer.id,
						producerId: consumer.producerId,
						id: consumer.id,
						kind: consumer.kind,
						rtpParameters: consumer.rtpParameters,
						producerPaused: consumer.producerPaused,
						paused: consumer.paused,
						appData: producerAppData,
					}
				});

				delete consumer.appData.suspended;
			} else {
				logger.debug({
					consumerId: consumer.id,
					consumerPeerId: consumerPeer.id,
					consumerPeerName: consumerPeer.displayName,
					producerPeerId: producerPeer.id,
					producerPeerName: producerPeer.displayName,
					kind: consumer.kind,
					producerId: consumer.producerId
				}, 'producerresume -> notify consumerResumed');

				consumerPeer.notify({
					method: 'consumerResumed',
					data: { consumerId: consumer.id }
				});
			}
		});

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

		if (consumer.producerPaused) {
			consumer.appData.suspended = true;

			logger.debug({
				consumerId: consumer.id,
				consumerPeerId: consumerPeer.id,
				consumerPeerName: consumerPeer.displayName,
				producerPeerId: producerPeer.id,
				producerPeerName: producerPeer.displayName,
				kind: consumer.kind,
				producerId: consumer.producerId
			}, 'consumer initially suspended');
		} else {
			consumerPeer.notify({
				method: 'newConsumer',
				data: {
					peerId: producerPeer.id,
					producerId: consumer.producerId,
					id: consumer.id,
					kind: consumer.kind,
					rtpParameters: consumer.rtpParameters,
					producerPaused: consumer.producerPaused,
					paused: consumer.paused,
					appData: producerAppData,
				}
			});

			logger.debug({
				consumerId: consumer.id,
				consumerPeerId: consumerPeer.id,
				consumerPeerName: consumerPeer.displayName,
				producerPeerId: producerPeer.id,
				producerPeerName: producerPeer.displayName,
				kind: consumer.kind,
				producerId: consumer.producerId,
				producerPaused: consumer.producerPaused,
				paused: consumer.paused
			}, 'notify newConsumer (initial)');
		}
	} catch (error) {
		return logger.error({ err: error }, 'createConsumer() [error: %o]');
	}
};

export const createDataConsumer = async (
	consumerPeer: Peer,
	producerPeer: Peer,
	dataProducer: DataProducer,
): Promise<void> => {
	const [ consumerError, consumerRouter ] = await consumerPeer.routerReady;
	const [ producerError, producerRouter ] = await producerPeer.routerReady;

	if (producerError || consumerError)
		return logger.warn(
			'createDataConsumer() cannot consume [producerPeerId: %s, producerId: %s]',
			producerPeer.id,
			dataProducer.id
		);

	const consumingTransport = consumerPeer.consumingTransport;

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

		// If the consuming peer went to a different session, maybe close the consumer
		if (!consumerPeer.sameSession(producerPeer))
			return dataConsumer.close();

		consumerPeer.dataConsumers.set(dataConsumer.id, dataConsumer);

		// The consuming peer went to a different session, maybe close the consumer
		consumerPeer.on('sessionIdChanged', () => {
			if (!consumerPeer.sameSession(producerPeer))
				dataConsumer.close();
		});

		// The producing peer went to a different session, maybe close the consumer
		producerPeer.on('sessionIdChanged', () => {
			if (!consumerPeer.sameSession(producerPeer))
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
		return logger.error({ err: error }, 'createDataConsumer() [error: %o]');
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
