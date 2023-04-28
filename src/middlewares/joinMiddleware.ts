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
				const {
					displayName,
					picture,
					rtpCapabilities,
				} = message.data;

				if (!rtpCapabilities)
					throw new Error('missing rtpCapabilities');

				peer.displayName = displayName;
				peer.picture = picture;
				peer.rtpCapabilities = rtpCapabilities;

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
							if (joinedPeer.inParent) {
								for (const producer of joinedPeer.producers.values()) {
									// We only want to consume producers in the main room
									if (!producer.closed) {
										// Avoid to create video consumer if a peer is in audio-only mode
										if (peer.audioOnly && producer.kind === MediaKind.VIDEO)
											continue;
	
										await createConsumer(peer, joinedPeer, producer);
									}
								}
							}
						}
					})(),
					(async () => {
						for (const joinedPeer of room.getPeers(peer)) {
							if (joinedPeer.inParent) {
								for (const dataProducer of joinedPeer.dataProducers.values()) {
									// We only want to consume dataProducers in the same session
									if (!dataProducer.closed)
										await createDataConsumer(peer, joinedPeer, dataProducer);
								}
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