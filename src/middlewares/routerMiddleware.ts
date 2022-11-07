import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeTransport } from '../media/PipeTransport';
import { Router } from '../media/Router';
import { WebRtcTransport } from '../media/WebRtcTransport';

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
			connection,
			message,
		} = context;

		if (router.id === message.data.routerId) {
			switch (message.method) {
				case 'routerClosed': {
					router.close();
					context.handled = true;

					break;
				}

				case 'newPipeTransport': {
					const {
						pipeTransportId: id,
						ip,
						port,
						srtpParameters
					} = message.data;

					const transport = new PipeTransport({
						router,
						connection,
						id,
						ip,
						port,
						srtpParameters,
					});

					router.addPipeTransport(transport);
					context.handled = true;

					break;
				}

				case 'newWebRtcTransport': {
					const {
						transportId: id,
						iceParameters,
						iceCandidates,
						dtlsParameters,
						sctpParameters
					} = message.data;

					const transport = new WebRtcTransport({
						router,
						connection,
						id,
						iceParameters,
						iceCandidates,
						dtlsParameters,
						sctpParameters,
					});

					router.addWebRtcTransport(transport);
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