import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { createConsumers } from '../common/consuming';

const logger = new Logger('InitialMediaMiddleware');

export const createInitialMediaMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createInitialMediaMiddleware() [room: %s]', room.sessionId);

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

		switch (message.method) {
			case 'retryConnection': {
				if (!peer.router)
					await room.retryAssignRouter(peer);
				context.handled = true;
				break;	
			}
			case 'rtpCapabilities': {
				const { rtpCapabilities } = message.data;

				if (!rtpCapabilities) throw new Error('missing rtpCapabilities');

				peer.rtpCapabilities = rtpCapabilities;
				context.handled = true;
				createConsumers(room, peer);
				break;
			}
			case 'getRouterRtpCapabilities': {
				if (!peer.router) return logger.warn('Peer %s has no router assigned', peer.id);

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

				if (!peer.router) return logger.warn('Peer %s has no router assigned', peer.id);

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