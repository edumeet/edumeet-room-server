import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { Consumer } from '../media/Consumer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';

const logger = new Logger('ConsumerMiddleware');

export const createConsumerMiddleware = ({
	consumer,
}: { consumer: Consumer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createConsumerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			consumer.router.id === message.data.routerId &&
			consumer.id === message.data.consumerId
		) {
			switch (message.method) {
				case 'consumerClosed': {
					consumer.close(true);
					context.handled = true;

					break;
				}

				case 'consumerPaused': {
					consumer.setProducerPaused();
					context.handled = true;

					break;
				}

				case 'consumerResumed': {
					consumer.setProducerResumed();
					context.handled = true;

					break;
				}

				case 'consumerScore': {
					const { score } = message.data;

					consumer.setScore(score);
					context.handled = true;

					break;
				}

				case 'consumerLayersChanged': {
					const { layers } = message.data;

					consumer.setLayers(layers);
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