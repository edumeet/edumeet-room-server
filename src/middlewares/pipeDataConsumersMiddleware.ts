import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('PipeDataConsumersMiddleware');

export const createPipeDataConsumersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeDataConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { pipeDataConsumerId, routerId },
				method,
			},
		} = context;

		if (!pipeDataConsumerId)
			return next();

		const router = routers.get(routerId);

		if (!router) {
			if (method === 'pipeDataConsumerClosed') {
				logger.debug({ routerId, pipeDataConsumerId }, 'method=pipeDataConsumerClosed - router already closed – ignoring');
				context.handled = true;
			}

			return next();
		}

		const pipeDataConsumer = router.pipeDataConsumers.get(pipeDataConsumerId);

		if (!pipeDataConsumer) {
			if (method === 'pipeDataConsumerClosed') {
				logger.debug({ routerId, pipeDataConsumerId }, 'method=pipeDataConsumerClosed - consumer already closed – ignoring');
				context.handled = true;
			}

			return next();
		}

		switch (method) {
			case 'pipeDataConsumerClosed': {
				logger.debug({
					routerId,
					pipeDataConsumerId,
					pipeDataProducerId: pipeDataConsumer.dataProducerId
				}, 'MediaNode -> pipeDataConsumerClosed');

				pipeDataConsumer.close(true);
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