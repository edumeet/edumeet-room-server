import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('WebRtcTransportsMiddleware');

export const createWebRtcTransportsMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createWebRtcTransportsMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { transportId, routerId },
				method,
			},
		} = context;

		if (!transportId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const webRtcTransport = router.webRtcTransports.get(transportId);

		if (!webRtcTransport)
			return next();

		switch (method) {
			case 'webRtcTransportClosed': {
				webRtcTransport.close();
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