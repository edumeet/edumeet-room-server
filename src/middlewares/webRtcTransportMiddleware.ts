import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { Consumer } from '../media/Consumer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Producer } from '../media/Producer';
import { WebRtcTransport } from '../media/WebRtcTransport';

const logger = new Logger('WebRtcTransportMiddleware');

export const createWebRtcTransportMiddleware = ({
	webRtcTransport,
}: { webRtcTransport: WebRtcTransport }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createWebRtcTransportMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			connection,
			message,
		} = context;

		if (
			webRtcTransport.router.id === message.data.routerId &&
			webRtcTransport.id === message.data.transportId
		) {
			switch (message.method) {
				case 'webRtcTransportClosed': {
					webRtcTransport.close();
					context.handled = true;

					break;
				}

				case 'restartedIce': {
					const {
						iceParameters
					} = message.data;

					webRtcTransport.iceParameters = iceParameters;
					context.handled = true;

					break;
				}

				case 'newProducer': {
					const {
						producerId: id,
						kind,
						rtpParameters,
						paused,
					} = message.data;

					const producer = new Producer({
						router: webRtcTransport.router,
						connection,
						id,
						kind,
						paused,
						rtpParameters,
					});

					webRtcTransport.addProducer(producer);
					context.handled = true;

					break;
				}

				case 'newConsumer': {
					const {
						consumerId: id,
						producerId,
						kind,
						paused,
						producerPaused,
						rtpParameters,
					} = message.data;

					const consumer = new Consumer({
						router: webRtcTransport.router,
						connection,
						id,
						producerId,
						kind,
						paused,
						producerPaused,
						rtpParameters,
					});

					webRtcTransport.addConsumer(consumer);
					context.handled = true;

					break;
				}

				default: {
					break;
				}
			}
		}

		return next();
	};

	return middleware;
};