import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('DataProducersMiddleware');

export const createDataProducersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createDataProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { dataProducerId, routerId },
				method,
			},
		} = context;

		if (!dataProducerId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const dataProducer = router.dataProducers.get(dataProducerId);

		if (!dataProducer)
			return next();

		switch (method) {
			case 'dataProducerClosed': {
				dataProducer.close(true);
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