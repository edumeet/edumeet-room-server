import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { WebRtcTransport } from '../media/WebRtcTransport';

const logger = new Logger('WebRtcTransportMiddleware');

export const createWebRtcTransportMiddleware = ({
	webRtcTransport,
}: { webRtcTransport: WebRtcTransport }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createWebRtcTransportMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			webRtcTransport.router.id === message.data.routerId &&
			webRtcTransport.id === message.data.transportId
		) {
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
		}

		return next();
	};

	return middleware;
};