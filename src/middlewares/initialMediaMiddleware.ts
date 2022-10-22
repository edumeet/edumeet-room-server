import config from '../../config/config.json';
import { thisSession } from '../common/checkSessionId';
import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('InitialMediaMiddleware');

export const createInitialMediaMiddleware = ({
	room,
	mediaService,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createInitialMediaMiddleware() [room: %s]', room.id);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response
		} = context;

		if (!thisSession(room, message))
			return next();

		if (!peer.router) peer.router = await mediaService.getRouter(room);

		switch (message.method) {
			case 'getRouterRtpCapabilities': {
				response.routerRtpCapabilities = peer.router?.rtpCapabilities;
				context.handled = true;

				break;
			}

			case 'createWebRtcTransport': {
				const { forceTcp, producing, consuming } = message.data;

				const webRtcTransportOptions = {
					...config.mediasoup.webRtcTransport,
					enableTcp: true,
					enableUdp: !forceTcp,
					preferUdp: !forceTcp,
					appData: { producing, consuming }
				};

				const transport = await peer.router?.createWebRtcTransport(
					webRtcTransportOptions
				);

				peer.transports.set(transport.id, transport);
				transport.observer.once('close', () => peer.transports.delete(transport.id));

				response.id = transport.id;
				response.iceParameters = transport.iceParameters;
				response.iceCandidates = transport.iceCandidates;
				response.dtlsParameters = transport.dtlsParameters;
				context.handled = true;

				const { maxIncomingBitrate } = config.mediasoup.webRtcTransport;
				
				if (maxIncomingBitrate) {
					(async () => {
						await transport.setMaxIncomingBitrate(maxIncomingBitrate);
					})().catch();
				}

				break;
			}

			case 'connectWebRtcTransport': {
				const { transportId, dtlsParameters } = message.data;
				const transport = peer.transports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				await transport.connect({ dtlsParameters });
				context.handled = true;

				break;
			}

			case 'restartIce': {
				const { transportId } = message.data;
				const transport = peer.transports.get(transportId);

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				response.iceParameters = await transport.restartIce();
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