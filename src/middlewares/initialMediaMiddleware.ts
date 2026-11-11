import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { createConsumers } from '../common/consuming';
import { WebRtcTransport } from '../media/WebRtcTransport';

const logger = new Logger('InitialMediaMiddleware');

// Transports a peer is creating right now, by direction and connection. The slot on the peer
// is only filled after the media node answers. Until then a further request for the same
// direction gets the transport that is being created: a burst creates one, and a client that
// asks again after a timeout gets the answer it did not wait for.
const creating = new WeakMap<object, Map<string, Promise<WebRtcTransport>>>();

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
				if (consuming && peer.consumingTransport) throw new Error('cannot create more than one consuming WebRtcTransport');
				if (producing && peer.producingTransport) throw new Error('cannot create more than one producing WebRtcTransport');

				// Per connection: a request still running for a connection that was replaced must
				// neither block the new one nor answer it.
				const generation = peer.connectionGeneration;
				const slot = `${producing ? 'producing' : 'consuming'}:${generation}`;
				const pending = creating.get(peer) ?? new Map<string, Promise<WebRtcTransport>>();

				creating.set(peer, pending);

				let creation = pending.get(slot);

				if (!creation) {
					creation = (async () => {
						try {
							const [ error, router ] = await peer.routerReady;

							if (error) throw error;

							const created = await router.createWebRtcTransport({
								forceTcp,
								enableSctp,
								appData: {
									producing,
									consuming,
								}
							});

							// The peer may have left, or reconnected, while the media node was answering.
							// After a reconnect the answer would go to the old socket, so the client would
							// never learn this transport, and it would block the new connection's slot.
							if (peer.closed || peer.connectionGeneration !== generation) {
								created.close();

								throw new Error(peer.closed ? 'peer closed' : 'connection replaced');
							}

							if (producing) peer.producingTransport = created;

							if (consuming) {
								peer.consumingTransport = created;

								if (room.peers.has(peer) && !peer.initialConsume) {
									peer.initialConsume = true;

									createConsumers(room, peer);
								}
							}

							created.once('close', () => {
								if (producing && peer.producingTransport === created) peer.producingTransport = undefined;

								if (consuming && peer.consumingTransport === created) {
									peer.consumingTransport = undefined;
									peer.initialConsume = false;
								}

								peer.notify({
									method: 'transportClosed',
									data: { transportId: created.id }
								});
							});

							return created;
						} finally {
							pending.delete(slot);
						}
					})();

					pending.set(slot, creation);
				}

				const transport = await creation;

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
