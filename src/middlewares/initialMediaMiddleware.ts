import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
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

		if (!peer.router) peer.router = await mediaService.getRouter(room, peer);

		switch (message.method) {
			case 'getRouterRtpCapabilities': {
				response.routerRtpCapabilities = peer.router.rtpCapabilities;
				context.handled = true;

				break;
			}

			case 'createWebRtcTransport': {
				const {
					forceTcp,
					producing,
					consuming,
					sctpCapabilities,
				} = message.data;

				const transport = await peer.router.createWebRtcTransport({
					forceTcp,
					sctpCapabilities,
					appData: {
						producing,
						consuming,
					}
				});

				if (!transport)
					throw new Error('transport not found');

				peer.transports.set(transport.id, transport);
				transport.once('close', () => {
					peer.transports.delete(transport.id);

					peer.notify({
						method: 'transportClosed',
						data: { transportId: transport.id }
					});
				});

				response.id = transport.id;
				response.iceParameters = transport.iceParameters;
				response.iceCandidates = transport.iceCandidates;
				response.dtlsParameters = transport.dtlsParameters;
				response.sctpParameters = transport.sctpParameters;
				context.handled = true;

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