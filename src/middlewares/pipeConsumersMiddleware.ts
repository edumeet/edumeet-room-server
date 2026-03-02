import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('PipeConsumersMiddleware');

export const createPipeConsumersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { pipeConsumerId, routerId },
				method,
			},
		} = context;

		if (!pipeConsumerId)
			return next();

		const router = routers.get(routerId);

		if (!router) {
			if (method === 'pipeConsumerClosed') {
				logger.debug({ routerId, pipeConsumerId }, 'method=pipeConsumerClosed - router already closed – ignoring');
				context.handled = true;
			}

			return next();
		}

		const pipeConsumer = router.pipeConsumers.get(pipeConsumerId);

		if (!pipeConsumer) {
			if (method === 'pipeConsumerClosed') {
				logger.debug({ routerId, pipeConsumerId }, 'method=pipeConsumerClosed - consumer already closed – ignoring');
				context.handled = true;
			}

			return next();
		}

		switch (method) {
			case 'pipeConsumerClosed': {
				logger.debug({
					routerId,
					pipeConsumerId,
					kind: pipeConsumer.kind,
					pipeProducerId: pipeConsumer.producerId
				}, 'MediaNode -> pipeConsumerClosed');

				pipeConsumer.close(true);
				context.handled = true;

				break;
			}

			case 'pipeConsumerPaused': {
				logger.debug({
					routerId,
					pipeConsumerId,
					kind: pipeConsumer.kind,
					pipeProducerId: pipeConsumer.producerId
				}, 'MediaNode -> pipeConsumerPaused');

				pipeConsumer.setProducerPaused();
				context.handled = true;

				break;
			}

			case 'pipeConsumerResumed': {
				logger.debug({
					routerId,
					pipeConsumerId,
					kind: pipeConsumer.kind,
					pipeProducerId: pipeConsumer.producerId
				}, 'MediaNode -> pipeConsumerResumed');

				pipeConsumer.setProducerResumed();
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