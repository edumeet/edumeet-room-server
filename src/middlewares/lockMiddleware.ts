import { Logger, Middleware } from 'edumeet-common';
import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('LockMiddleware');

export const createLockMiddleware = ({
	room,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createLockMiddleware() [room: %s]', room.id);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
		} = context;

		if (!thisSession(room, message))
			return next();
		
		switch (message.method) {
			case 'lockRoom': {
				if (!hasPermission(room, peer, Permission.CHANGE_ROOM_LOCK))
					throw new Error('peer not authorized');

				room.locked = true;

				room.notifyPeers('lockRoom', {
					peerId: peer.id,
				}, peer);

				context.handled = true;

				break;
			}

			case 'unlockRoom': {
				if (!hasPermission(room, peer, Permission.CHANGE_ROOM_LOCK))
					throw new Error('peer not authorized');

				room.locked = false;

				room.notifyPeers('unlockRoom', {
					peerId: peer.id,
				}, peer);

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