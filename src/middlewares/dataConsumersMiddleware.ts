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

		if (!router)
			return next();

		const dataConsumer = router.dataConsumers.get(dataConsumerId);

		if (!dataConsumer)
			return next();

		switch (method) {
			case 'dataConsumerClosed': {
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