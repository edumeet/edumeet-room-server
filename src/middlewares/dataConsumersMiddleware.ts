import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('DataConsumersMiddleware');

export const createDataConsumersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createDataConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { dataConsumerId, routerId },
				method,
			},
		} = context;

		if (!dataConsumerId)
			return next();

		const router = routers.get(routerId);

		if (!router) {
			if (method === 'dataConsumerClosed') {
				logger.debug({ routerId, dataConsumerId }, 'method=dataConsumerClosed - router already closed – ignoring');
				context.handled = true;
			}

			return next();
		}

		const dataConsumer = router.dataConsumers.get(dataConsumerId);

		if (!dataConsumer) {
			if (method === 'dataConsumerClosed') {
				logger.debug({ routerId, dataConsumerId }, 'method=dataConsumerClosed - consumer already closed – ignoring');
				context.handled = true;
			}

			return next();
		}

		switch (method) {
			case 'dataConsumerClosed': {
				logger.debug({
					routerId,
					dataConsumerId,
					dataProducerId: dataConsumer.dataProducerId
				}, 'MediaNode -> dataConsumerClosed');

				dataConsumer.close(true);
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