import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { createConsumers } from '../common/consuming';

const logger = new Logger('InitialMediaMiddleware');

// Directions a peer is creating a transport for right now. The slot on the peer is only
// filled after the media node answers, so without this a burst of requests would each
// create a transport, and only the last one would be tracked and closed.
const creating = new WeakMap<object, Set<string>>();

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
					enableSctp,
				} = message.data;

				if (producing && consuming) throw new Error('cannot create WebRtcTransport with both producing and consuming');
				if (!producing && !consuming) throw new Error('cannot create WebRtcTransport with neither producing nor consuming');
				const direction = producing ? 'producing' : 'consuming';
				// Reserved per connection: a request still running for a connection that was
				// replaced must not block the new one.
				const generation = peer.connectionGeneration;
				const slot = `${direction}:${generation}`;
				const pending = creating.get(peer) ?? new Set<string>();

				if ((consuming && peer.consumingTransport) || pending.has(slot))
					throw new Error(`cannot create more than one ${direction} WebRtcTransport`);
				if (producing && peer.producingTransport) throw new Error('cannot create more than one producing WebRtcTransport');

				pending.add(slot);
				creating.set(peer, pending);

				let transport;

				try {
					const [ error, router ] = await peer.routerReady;

					if (error) throw error;

					transport = await router.createWebRtcTransport({
						forceTcp,
						enableSctp,
						appData: {
							producing,
							consuming,
						}
					});
				} finally {
					pending.delete(slot);
				}

				// The peer may have left, or reconnected, while the media node was answering.
				// After a reconnect the answer would go to the old socket, so the client would
				// never learn this transport, and it would block the new connection's slot.
				if (peer.closed || peer.connectionGeneration !== generation) {
					transport.close();

					throw new Error(peer.closed ? 'peer closed' : 'connection replaced');
				}

				if (producing) peer.producingTransport = transport;

				if (consuming) {
					peer.consumingTransport = transport;

					if (room.peers.has(peer) && !peer.initialConsume) {
						peer.initialConsume = true;

						createConsumers(room, peer);
					}
				}

				transport.once('close', () => {
					if (producing && peer.producingTransport === transport) peer.producingTransport = undefined;

					if (consuming && peer.consumingTransport === transport) {
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
