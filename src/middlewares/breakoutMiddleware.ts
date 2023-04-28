import { Logger, MediaKind, Middleware } from 'edumeet-common';
import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import { createConsumer, createDataConsumer } from '../common/consuming';

const logger = new Logger('BreakoutMiddleware');

export const createBreakoutMiddleware = ({
	room,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createBreakoutMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response,
		} = context;

		if (!thisSession(room, message))
			return next();
		
		switch (message.method) {
			case 'createBreakoutRoom': {
				if (!hasPermission(room, peer, Permission.CREATE_ROOM))
					throw new Error('peer not authorized');

				const { name } = message.data;
				const newBreakoutRoom = new BreakoutRoom({ parent: room, name });

				room.addBreakoutRoom(newBreakoutRoom);
				room.notifyPeers('newBreakoutRoom', { name, sessionId: newBreakoutRoom.sessionId }, peer);

				response.sessionId = newBreakoutRoom.sessionId;

				context.handled = true;

				break;
			}

			case 'joinBreakoutRoom': {
				const { sessionId } = message.data;
				const roomToJoin = room.breakoutRooms.get(sessionId);

				if (!roomToJoin)
					throw new Error('BreakoutRoom not found');

				roomToJoin.addPeer(peer);

				response.chatHistory = roomToJoin.chatHistory;
				response.fileHistory = roomToJoin.fileHistory;

				context.handled = true;

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