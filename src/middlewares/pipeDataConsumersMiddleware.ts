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

		if (!router)
			return next();

		const pipeDataConsumer = router.pipeDataConsumers.get(pipeDataConsumerId);

		if (!pipeDataConsumer)
			return next();

		switch (method) {
			case 'pipeDataConsumerClosed': {
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