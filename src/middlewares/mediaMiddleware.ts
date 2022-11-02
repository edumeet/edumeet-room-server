import { permittedProducer } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { createConsumer } from '../common/consuming';
import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('MediaMiddleware');

export const createMediaMiddleware = ({
	room,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createMediaMiddleware() [room: %s]', room.id);

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

				const { transportId, kind, rtpParameters } = message.data;
				const transport = peer.transports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				appData = {
					...appData,
					peerId: peer.id,
					sessionId: room.sessionId
				};

				try {
					const producer = await transport.produce({ kind, rtpParameters, appData });

					peer.producers.set(producer.id, producer);
					producer.once('close', () => peer.producers.delete(producer.id));

					producer.on('score', (score) => peer.notify({
						method: 'producerScore',
						data: { producerId: producer.id, score }
					}));

					response.id = producer.id;
					context.handled = true;

					(async () => {
						for (const consumerPeer of room.getPeers(peer)) {
							await createConsumer(consumerPeer, peer, producer);
						}
					})();
				} catch (error) {
					throw new Error('produce failed');
				}

				break;
			}

			case 'closeProducer': {
				const { producerId } = message.data;
				const producer = peer.producers.get(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

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

			case 'pauseConsumer': {
				const { consumerId } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.pause();
				context.handled = true;

				break;
			}

			case 'resumeConsumer': {
				const { consumerId } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.resume();
				context.handled = true;

				break;
			}

			case 'setConsumerPreferredLayers': {
				const { consumerId, spatialLayer, temporalLayer } = message.data;
				const consumer = peer.consumers.get(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.setPreferredLayers({ spatialLayer, temporalLayer });
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

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};