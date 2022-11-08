import { hasPermission, Permission } from '../common/authorization';
import { PeerContext } from '../Peer';
import { MiddlewareOptions } from '../common/types';
import { thisSession } from '../common/checkSessionId';
import { Logger, Middleware } from 'edumeet-common';

const logger = new Logger('LobbyMiddleware');

export const createLobbyMiddleware = ({
	room,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createLobbyMiddleware() [room: %s]', room.id);

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
			case 'promotePeer': {
				if (!hasPermission(room, peer, Permission.PROMOTE_PEER))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const peerToPromote = room.lobbyPeers.get(peerId);

				if (!peerToPromote)
					throw new Error('peer not found');

				room.promotePeer(peerToPromote);
				context.handled = true;

				break;
			}

			case 'promoteAllPeers': {
				if (!hasPermission(room, peer, Permission.PROMOTE_PEER))
					throw new Error('peer not authorized');

				room.promoteAllPeers();
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