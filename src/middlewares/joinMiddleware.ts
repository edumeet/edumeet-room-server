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
				response.chatHistory = room.chatHistory;
				response.fileHistory = room.fileHistory;
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

			case 'joinSession': {
				const { sessionId } = message.data;

				if (peer.sessionId === sessionId)
					throw new Error('Already in session');

				const leavingParent = peer.inParent;
				const joiningParent = room.sessionId === sessionId;
				const roomToJoin = joiningParent ? room : room.breakoutRooms.get(sessionId);

				if (!roomToJoin)
					throw new Error('Session not found');

				// If joining the parent session, we don't add it as it is already always there, and has all the history
				if (!joiningParent) {
					roomToJoin.addPeer(peer);

					response.chatHistory = roomToJoin.chatHistory;
					response.fileHistory = roomToJoin.fileHistory;
				}

				// If leaving parent room, we don't want to remove the peer
				if (!leavingParent) {
					const roomToLeave = room.breakoutRooms.get(peer.sessionId);

					roomToLeave?.removePeer(peer);
				}

				room.notifyPeers('changeSessionId', { peerId: peer.id, sessionId: roomToJoin.sessionId }, peer);

				// This will trigger the consumers of peers not in the room to be closed
				peer.sessionId = roomToJoin.sessionId;

				context.handled = true;

				// Create consumers for the joined peer, but only if it's not in the parent room.
				// If it's in the parent room, the consumers will have been created already.
				if (!peer.inParent) {
					Promise.all([
						(async () => {
							for (const joinedPeer of roomToJoin.getPeers(peer)) {
								for (const producer of joinedPeer.producers.values()) {
									if (!producer.closed) {
										// Avoid to create video consumer if a peer is in audio-only mode
										if (peer.audioOnly && producer.kind === MediaKind.VIDEO)
											continue;

										await createConsumer(peer, joinedPeer, producer);
									}
								}
							}
						})(),
						(async () => {
							for (const joinedPeer of roomToJoin.getPeers(peer)) {
								for (const dataProducer of joinedPeer.dataProducers.values()) {
									if (!dataProducer.closed)
										await createDataConsumer(peer, joinedPeer, dataProducer);
								}
							}
						})()
					]);
				}

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