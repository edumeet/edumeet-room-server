import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('PipeTransportsMiddleware');

export const createPipeTransportsMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeTransportsMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { pipeTransportId, routerId },
				method,
			},
		} = context;

		if (!pipeTransportId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const pipeTransport = router.pipeTransports.get(pipeTransportId);

		if (!pipeTransport)
			return next();

		switch (method) {
			case 'pipeTransportClosed': {
				pipeTransport.close();
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