import { thisSession } from '../common/checkSessionId';
import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('LobbyPeerMiddleware');

export const createLobbyPeerMiddleware = ({
	room,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createLobbyPeerMiddleware() [room: %s]', room.id);

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
			case 'changeDisplayName': {
				const { displayName } = message.data;

				peer.displayName = displayName;

				// TODO: only send to PROMOTE_PEER peers
				room.notifyPeers('lobby:changeDisplayName', {
					peerId: peer.id,
					displayName
				}, peer);

				context.handled = true;

				break;
			}

			case 'changePicture': {
				const { picture } = message.data;

				peer.picture = picture;

				// TODO: only send to PROMOTE_PEER peers
				room.notifyPeers('lobby:changePicture', {
					peerId: peer.id,
					picture
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