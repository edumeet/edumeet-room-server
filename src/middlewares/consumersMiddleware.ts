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
				logger.debug({
					routerId,
					consumerId,
					kind: consumer.kind,
					producerId: consumer.producerId
				}, 'MediaNode -> consumerClosed');

				consumer.close(true);
				context.handled = true;

				break;
			}

			case 'consumerProducerPaused': {
				logger.debug({
					routerId,
					consumerId,
					kind: consumer.kind,
					producerId: consumer.producerId
				}, 'MediaNode -> consumerProducerPaused');

				consumer.setProducerPaused();
				context.handled = true;

				break;
			}

			case 'consumerProducerResumed': {
				logger.debug({
					routerId,
					consumerId,
					kind: consumer.kind,
					producerId: consumer.producerId
				}, 'MediaNode -> consumerProducerResumed');

				consumer.setProducerResumed();
				context.handled = true;

				break;
			}

			case 'consumerScore': {
				logger.debug({
					routerId,
					consumerId,
					score
				}, 'MediaNode -> consumerScore');

				consumer.setScore(score);
				context.handled = true;

				break;
			}

			case 'consumerLayersChanged': {
				logger.debug({
					routerId,
					consumerId,
					layers
				}, 'MediaNode -> consumerLayersChanged');

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