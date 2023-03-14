import { Logger, Middleware } from 'edumeet-common';
import { Consumer } from '../media/Consumer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';

const logger = new Logger('ConsumersMiddleware');

export const createConsumersMiddleware = ({
	routerId,
	consumers,
}: {
	routerId: string;
	consumers: Map<string, Consumer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.consumerId)
			return next();

		const consumer = consumers.get(message.data.consumerId);

		if (!consumer)
			return next();

		switch (message.method) {
			case 'consumerClosed': {
				consumer.close(true);
				context.handled = true;

				break;
			}

			case 'consumerProducerPaused': {
				consumer.setProducerPaused();
				context.handled = true;

				break;
			}

			case 'consumerProducerResumed': {
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

		return next();
	};

	return middleware;
};