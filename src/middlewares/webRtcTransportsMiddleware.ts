import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { WebRtcTransport } from '../media/WebRtcTransport';

const logger = new Logger('WebRtcTransportsMiddleware');

export const createWebRtcTransportsMiddleware = ({
	routerId,
	webRtcTransports,
}: {
	routerId: string;
	webRtcTransports: Map<string, WebRtcTransport>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createWebRtcTransportsMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.transportId)
			return next();

		const webRtcTransport = webRtcTransports.get(message.data.transportId);

		if (!webRtcTransport)
			return next();

		switch (message.method) {
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