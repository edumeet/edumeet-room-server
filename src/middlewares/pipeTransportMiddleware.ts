import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeConsumer } from '../media/PipeConsumer';
import { PipeProducer } from '../media/PipeProducer';
import { PipeTransport } from '../media/PipeTransport';

const logger = new Logger('PipeTransportMiddleware');

export const createPipeTransportMiddleware = ({
	pipeTransport,
}: { pipeTransport: PipeTransport }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeTransportMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			connection,
			message,
		} = context;

		if (
			pipeTransport.router.id === message.data.routerId &&
			pipeTransport.id === message.data.pipeTransportId
		) {
			switch (message.method) {
				case 'pipeTransportClosed': {
					pipeTransport.close();
					context.handled = true;

					break;
				}

				case 'newPipeProducer': {
					const {
						pipeProducerId: id,
						kind,
						rtpParameters,
						paused,
					} = message.data;

					const pipeProducer = new PipeProducer({
						router: pipeTransport.router,
						connection,
						id,
						kind,
						paused,
						rtpParameters,
					});

					pipeTransport.addPipeProducer(pipeProducer);
					context.handled = true;

					break;
				}

				case 'newPipeConsumer': {
					const {
						pipeConsumerId: id,
						producerId,
						kind,
						producerPaused,
						rtpParameters,
					} = message.data;

					const pipeConsumer = new PipeConsumer({
						router: pipeTransport.router,
						connection,
						id,
						producerId,
						kind,
						producerPaused,
						rtpParameters,
					});

					pipeTransport.addPipeConsumer(pipeConsumer);
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