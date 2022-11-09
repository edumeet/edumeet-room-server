import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('RouterMiddleware');

export const createRouterMiddleware = ({
	router,
}: { router: Router }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createRouterMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (router.id === message.data.routerId) {
			switch (message.method) {
				case 'routerClosed': {
					router.close();
					context.handled = true;

					break;
				}

				default: {
					break;
				}
			}
		}

		return next();
	};

	return middleware;
};