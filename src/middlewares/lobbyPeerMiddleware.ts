import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';

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
				room.notifyPeers({ method: 'lobby:changeDisplayName',
					data: {
						peerId: peer.id,
						displayName
					},
					excludePeer: peer });

				context.handled = true;

				break;
			}

			case 'changePicture': {
				const { picture } = message.data;

				peer.picture = picture;

				// TODO: only send to PROMOTE_PEER peers
				room.notifyPeers({ method: 'lobby:changePicture',
					data: {
						peerId: peer.id,
						picture
					},
					excludePeer: peer });

				context.handled = true;

				break;
			}

			case 'changeAudioOnly': {
				const { audioOnly } = message.data;

				peer.audioOnly = audioOnly;

				room.notifyPeers({ method: 'lobby:changeAudioOnly',
					data: {
						peerId: peer.id,
						audioOnly
					},
					excludePeer: peer });

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