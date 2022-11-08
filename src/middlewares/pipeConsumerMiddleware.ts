import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeConsumer } from '../media/PipeConsumer';

const logger = new Logger('PipeConsumerMiddleware');

export const createPipeConsumerMiddleware = ({
	pipeConsumer,
}: { pipeConsumer: PipeConsumer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeConsumerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			pipeConsumer.router.id === message.data.routerId &&
			pipeConsumer.id === message.data.pipeConsumerId
		) {
			switch (message.method) {
				case 'pipeConsumerClosed': {
					pipeConsumer.close(true);
					context.handled = true;

					break;
				}

				case 'pipeConsumerPaused': {
					pipeConsumer.setProducerPaused();
					context.handled = true;

					break;
				}

				case 'pipeConsumerResumed': {
					pipeConsumer.setProducerResumed();
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