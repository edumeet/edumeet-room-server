import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('ConsumersMiddleware');

export const createConsumersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { consumerId, routerId, score, layers },
				method,
			},
		} = context;

		if (!consumerId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const consumer = router.consumers.get(consumerId);

		if (!consumer)
			return next();

		switch (method) {
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
				consumer.setScore(score);
				context.handled = true;

				break;
			}

			case 'consumerLayersChanged': {
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