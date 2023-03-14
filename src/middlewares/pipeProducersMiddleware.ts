import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('PipeProducersMiddleware');

export const createPipeProducersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { pipeProducerId, routerId },
				method,
			},
		} = context;

		if (!pipeProducerId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const pipeProducer = router.pipeProducers.get(pipeProducerId);

		if (!pipeProducer)
			return next();

		switch (method) {
			case 'pipeProducerClosed': {
				pipeProducer.close(true);
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