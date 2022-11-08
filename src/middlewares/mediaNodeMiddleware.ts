import { Logger, Middleware } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('MediaNodeMiddleware');

export const createMediaNodeMiddleware = ({
	mediaNode
}: {
	mediaNode: MediaNode;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createMediaNodeMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			connection,
			message,
		} = context;

		if (message.method === 'newRouter') {
			const {
				routerId: id,
				rtpCapabilities
			} = message.data;

			const router = new Router({
				mediaNode,
				connection,
				id,
				rtpCapabilities,
			});

			mediaNode.addRouter(router);

			context.handled = true;
		}

		return next();
	};

	return middleware;
};