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

		if (!thisSession(room, message)) return next();

		switch (message.method) {
			case 'createWebRtcTransport': {
				const {
					forceTcp,
					producing,
					consuming,
					sctpCapabilities,
				} = message.data;

				if (producing && consuming) throw new Error('cannot create WebRtcTransport with both producing and consuming');
				if (!producing && !consuming) throw new Error('cannot create WebRtcTransport with neither producing nor consuming');
				if (consuming && peer.consumingTransport) throw new Error('cannot create more than one consuming WebRtcTransport');
				if (producing && peer.producingTransport) throw new Error('cannot create more than one producing WebRtcTransport');

				const [ error, router ] = await peer.routerReady;

				if (error) throw error;

				const transport = await router.createWebRtcTransport({
					forceTcp,
					sctpCapabilities,
					appData: {
						producing,
						consuming,
					}
				});

				if (producing) peer.producingTransport = transport;

				if (consuming) {
					peer.consumingTransport = transport;

					if (room.peers.has(peer) && !peer.initialConsume) {
						peer.initialConsume = true;

						createConsumers(room, peer);
					}
				}

				transport.once('close', () => {
					if (producing) peer.producingTransport = undefined;

					if (consuming) {
						peer.consumingTransport = undefined;
						peer.initialConsume = false;
					}

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

				let transport;

				if (transportId === peer.producingTransport?.id)
					transport = peer.producingTransport;
				else if (transportId === peer.consumingTransport?.id)
					transport = peer.consumingTransport;

				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				await transport.connect({ dtlsParameters });
				context.handled = true;

				break;
			}

			case 'restartIce': {
				const { transportId } = message.data;

				let transport;

				if (transportId === peer.producingTransport?.id)
					transport = peer.producingTransport;
				else if (transportId === peer.consumingTransport?.id)
					transport = peer.consumingTransport;

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
