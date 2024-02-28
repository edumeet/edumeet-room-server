import { Logger, Middleware } from 'edumeet-common';
import { permittedProducer } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { createConsumer, createDataConsumer } from '../common/consuming';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { LayerWatcher } from '../common/layerWatcher';
import { LayerReporter } from '../common/layerReporter';

const logger = new Logger('MediaMiddleware');

export const createMediaMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createMediaMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response
		} = context;

		if (!thisSession(room, message))
			return next();

		switch (message.method) {
			case 'produce': {
				let { appData } = message.data;

				permittedProducer(appData.source, room, peer);

				const { kind, rtpParameters } = message.data;

				if (!peer.producingTransport)
					throw new Error(`no producing transport for peer "${peer.id}"`);

				const layerWatcher = kind === 'video' ? new LayerWatcher() : undefined;

				appData = { ...appData, peerId: peer.id, layerWatcher };

				const producer = await peer.producingTransport.produce({ kind, rtpParameters, appData });

				peer.producers.set(producer.id, producer);
				producer.once('close', () => {
					peer.producers.delete(producer.id);

					if (!producer.appData.remoteClosed) {
						peer.notify({
							method: 'producerClosed',
							data: { producerId: producer.id }
						});
					}
				});

				producer.on('score', (score) => peer.notify({
					method: 'producerScore',
					data: { producerId: producer.id, score }
				}));

				layerWatcher?.on('newLayer', (spatialLayer) => peer.notify({
					method: 'newProducerLayer',
					data: { producerId: producer.id, spatialLayer }
				}));

				response.id = producer.id;
				context.handled = true;

				(async () => {
					for (const consumerPeer of room.getPeers(peer)) {
						if (!consumerPeer.sameSession(peer))
							continue;

						await createConsumer(consumerPeer, peer, producer);
					}
				})();

				break;
			}

			case 'closeProducer': {
				const { producerId } = message.data;
				const producer = peer.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				producer.appData.remoteClosed = true;
				producer.close();
				context.handled = true;

				break;
			}

			case 'pauseProducer': {
				const { producerId } = message.data;
				const producer = peer.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await producer.pause();
				context.handled = true;

				break;
			}

			case 'resumeProducer': {
				const { producerId } = message.data;
				const producer = peer.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await producer.resume();
				context.handled = true;

				break;
			}

			case 'produceData': {
				let { appData } = message.data;

				const {
					sctpStreamParameters,
					label,
					protocol,
				} = message.data;

				if (!peer.producingTransport)
					throw new Error(`no producing transport for peer "${peer.id}"`);

				appData = {
					...appData,
					peerId: peer.id,
				};

				const dataProducer = await peer.producingTransport.produceData({
					sctpStreamParameters,
					label,
					protocol,
					appData
				});

				peer.dataProducers.set(dataProducer.id, dataProducer);
				dataProducer.once('close', () => {
					peer.dataProducers.delete(dataProducer.id);

					if (!dataProducer.appData.remoteClosed) {
						peer.notify({
							method: 'dataProducerClosed',
							data: { dataProducerId: dataProducer.id }
						});
					}
				});

				response.id = dataProducer.id;
				context.handled = true;

				(async () => {
					for (const consumerPeer of room.getPeers(peer)) {
						if (!consumerPeer.sameSession(peer))
							continue;

						await createDataConsumer(consumerPeer, peer, dataProducer);
					}
				})();

				break;
			}

			case 'closeDataProducer': {
				const { dataProducerId } = message.data;
				const dataProducer = peer.dataProducers.get(dataProducerId);

				if (!dataProducer)
					throw new Error(`dataProducer with id "${dataProducerId}" not found`);

				dataProducer.appData.remoteClosed = true;
				dataProducer.close();
				context.handled = true;

				break;
			}

			case 'pauseConsumer': {
				const { consumerId } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				const layerReporter = consumer.appData.layerReporter as LayerReporter;

				await consumer.pause();
				layerReporter?.updateLayer(0);
				context.handled = true;

				break;
			}

			case 'resumeConsumer': {
				const { consumerId } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				const layerReporter = consumer.appData.layerReporter as LayerReporter;

				await consumer.resume();
				layerReporter?.updateLayer(consumer.preferredLayers.spatialLayer);
				context.handled = true;

				break;
			}

			case 'setConsumerPreferredLayers': {
				const { consumerId, spatialLayer, temporalLayer } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				const layerReporter = consumer.appData.layerReporter as LayerReporter;

				await consumer.setPreferredLayers({ spatialLayer, temporalLayer });
				layerReporter?.updateLayer(spatialLayer);
				context.handled = true;

				break;
			}

			case 'setConsumerPriority': {
				const { consumerId, priority } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.setPriority(priority);
				context.handled = true;

				break;
			}

			case 'requestConsumerKeyFrame': {
				const { consumerId } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.requestKeyFrame();
				context.handled = true;

				break;
			}

			case 'peerLoad': {
				const { rtpCapabilities, peerId } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				remotePeer.notify({
					method: 'peerLoad',
					data: { rtpCapabilities, peerId: peer.id }
				});

				context.handled = true;

				break;
			}

			case 'peerConnect': {
				const { dtlsParameters, iceParameters, peerId, direction } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				remotePeer.notify({
					method: 'peerConnect',
					data: { dtlsParameters, iceParameters, peerId: peer.id, direction }
				});

				context.handled = true;

				break;
			}

			case 'candidate': {
				const { candidate, peerId, direction } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				remotePeer.notify({
					method: 'candidate',
					data: { candidate, peerId: peer.id, direction }
				});

				context.handled = true;

				break;
			}

			case 'peerProduce': {
				const { id, kind, rtpParameters, appData, peerId } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				permittedProducer(appData.source, room, remotePeer);

				remotePeer.notify({
					method: 'peerProduce',
					data: { id, kind, rtpParameters, appData, peerId: peer.id }
				});

				context.handled = true;

				break;
			}

			case 'peerCloseProducer': {
				const { producerId, peerId } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				remotePeer.notify({
					method: 'peerCloseProducer',
					data: { producerId }
				});

				context.handled = true;

				break;
			}

			case 'peerPauseProducer': {
				const { producerId, peerId } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				remotePeer.notify({
					method: 'peerPauseProducer',
					data: { producerId }
				});

				context.handled = true;

				break;
			}

			case 'peerResumeProducer': {
				const { producerId, peerId } = message.data;
				const remotePeer = room.peers.get(peerId);

				if (!remotePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				remotePeer.notify({
					method: 'peerResumeProducer',
					data: { producerId }
				});

				context.handled = true;

				break;
			}

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};
