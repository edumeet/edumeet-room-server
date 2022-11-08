import { Logger, Middleware } from 'edumeet-common';
import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';
import Room from '../Room';

const logger = new Logger('BreakoutMiddleware');

export const createBreakoutMiddleware = ({
	room,
	mediaService,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createBreakoutMiddleware() [room: %s]', room.id);

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
			case 'createRoom': {
				if (!hasPermission(room, peer, Permission.CREATE_ROOM))
					throw new Error('peer not authorized');

				const { name } = message.data;
				const newRoom = new Room({ id: room.id, name, mediaService, parent: room });

				response.name = newRoom.name;
				response.sessionId = newRoom.sessionId;
				room.addRoom(newRoom);
				room.notifyPeers('newRoom', { name: room.name, sessionId: room.sessionId }, peer);
				context.handled = true;

				break;
			}

			case 'joinRoom': {
				const { sessionId } = message.data;
				const joinRoom = room.rooms.get(sessionId);

				if (!joinRoom)
					throw new Error('room not found');

				joinRoom.addPeer(peer);
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