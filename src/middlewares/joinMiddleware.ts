import { Logger, MediaKind, Middleware } from 'edumeet-common';
import {
	hasPermission,
	Permission,
} from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { createConsumer, createDataConsumer } from '../common/consuming';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('JoinMiddleware');

export const createJoinMiddleware = ({
	room,
	chatHistory,
	fileHistory,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createJoinMiddleware() [room: %s]', room.id);

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
			case 'join': {
				// These input parameters should not be provided to sub-rooms
				// (i.e. breakout rooms), only to the main room on initial join
				if (!room.parent) {
					const {
						displayName,
						picture,
						audioOnly,
						rtpCapabilities,
					} = message.data;

					if (!rtpCapabilities)
						throw new Error('missing rtpCapabilities');

					peer.displayName = displayName;
					peer.picture = picture;
					peer.audioOnly = audioOnly;
					peer.rtpCapabilities = rtpCapabilities;
				}

				const peers = room.getPeers().map((p) => (p.peerInfo));
				const lobbyPeers = hasPermission(room, peer, Permission.PROMOTE_PEER) ?
					room.lobbyPeers.items.map((p) => (p.peerInfo)) : [];

				response.peers = peers;
				response.chatHistory = chatHistory;
				response.fileHistory = fileHistory;
				response.lobbyPeers = lobbyPeers;
				response.locked = room.locked;

				room.joinPeer(peer);
				context.handled = true;

				Promise.all([
					(async () => {
						for (const joinedPeer of room.getPeers(peer)) {
							for (const producer of joinedPeer.producers.values()) {
								const { appData: { sessionId } } = producer;

								// We only want to consume producers in the same session
								if (!producer.closed && sessionId === room.sessionId) {
									// Avoid to create video consumer if a peer is in audio-only mode
									if (
										producer.kind === MediaKind.AUDIO ||
										(producer.kind === MediaKind.VIDEO && !peer.audioOnly)
									)
										await createConsumer(peer, joinedPeer, producer);
								}
							}
						}
					})(),
					(async () => {
						for (const joinedPeer of room.getPeers(peer)) {
							for (const dataProducer of joinedPeer.dataProducers.values()) {
								const { appData: { sessionId } } = dataProducer;

								// We only want to consume dataProducers in the same session
								if (!dataProducer.closed && sessionId === room.sessionId)
									await createDataConsumer(peer, joinedPeer, dataProducer);
							}
						}
					})()
				]);

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