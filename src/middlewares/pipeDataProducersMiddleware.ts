import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('PipeDataProducersMiddleware');

export const createPipeDataProducersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeDataProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { pipeDataProducerId, routerId },
				method,
			},
		} = context;

		if (!pipeDataProducerId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const pipeDataProducer = router.pipeDataProducers.get(pipeDataProducerId);

		if (!pipeDataProducer)
			return next();

		switch (method) {
			case 'pipeDataProducerClosed': {
				pipeDataProducer.close(true);
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