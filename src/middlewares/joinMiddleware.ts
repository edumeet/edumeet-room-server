import {
	hasPermission,
	Permission,
} from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { createConsumer } from '../common/createConsumer';
import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
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
						rtpCapabilities,
					} = message.data;
	
					if (!rtpCapabilities)
						throw new Error('missing rtpCapabilities');
	
					peer.displayName = displayName;
					peer.picture = picture;
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

				if (peer.router) {
					for (const joinedPeer of room.getPeers(peer)) {
						if (
							joinedPeer.router &&
							peer.router !== joinedPeer.router
						) {
							for (const producer of peer.producers.values()) {
								if (
									!producer.closed &&
									!joinedPeer.router.closed &&
									!peer.router
								) {
									await joinedPeer.router.pipeToRouter({
										producerId: producer.id,
										router: peer.router,
									});
								}
							}
						}
					}
				}

				room.joinPeer(peer);
				context.handled = true;

				(async () => {
					for (const joinedPeer of room.getPeers(peer)) {
						for (const producer of joinedPeer.producers.values()) {
							const { appData: { sessionId } } = producer;

							// We only want to consume producers in the same session
							if (!producer.closed && sessionId === room.sessionId)
								await createConsumer(peer, joinedPeer, producer);
						}
					}
				})();

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