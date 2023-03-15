import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('ProducersMiddleware');

export const createProducersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { producerId, routerId, score },
				method,
			},
		} = context;

		if (!producerId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const producer = router.producers.get(producerId);

		if (!producer)
			return next();

		switch (method) {
			case 'producerClosed': {
				producer.close(true);
				context.handled = true;

				break;
			}

			case 'producerScore': {
				producer.setScore(score);
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