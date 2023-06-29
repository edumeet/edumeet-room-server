import { Permission } from '../common/authorization';
import { PeerContext } from '../Peer';
import { thisSession } from '../common/checkSessionId';
import { Logger, Middleware } from 'edumeet-common';
import Room from '../Room';

const logger = new Logger('LobbyMiddleware');

export const createLobbyMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createLobbyMiddleware() [room: %s]', room.sessionId);

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
				if (!peer.hasPermission(Permission.PROMOTE_PEER))
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
				if (!peer.hasPermission(Permission.PROMOTE_PEER))
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