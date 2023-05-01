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

			case 'closeBreakoutRoom': {
				if (!hasPermission(room, peer, Permission.CREATE_ROOM))
					throw new Error('peer not authorized');

				const { sessionId } = message.data;
				const roomToClose = room.breakoutRooms.get(sessionId);

				if (!roomToClose)
					throw new Error('BreakoutRoom not found');

				roomToClose.close();
				room.notifyPeers('breakoutRoomClosed', { sessionId }, peer);

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