import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { verifyPeer } from '../common/token';

const logger = new Logger('LobbyPeerMiddleware');

export const createLobbyPeerMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createLobbyPeerMiddleware() [room: %s]', room.sessionId);

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

			case 'updateToken': {
				const { token } = message.data;
				const managedId = token ? verifyPeer(token) : undefined;

				peer.managedId = managedId;
				room.updatePeerPermissions(peer, true);

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