import { Permission } from '../common/authorization';
import { PeerContext } from '../Peer';
import { thisSession } from '../common/checkSessionId';
import { Logger, Middleware } from 'edumeet-common';
import Room from '../Room';

const logger = new Logger('ModeratorMiddleware');

export const createModeratorMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createModeratorMiddleware() [room: %s]', room.sessionId);

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
			case 'moderator:clearChat': {
				if (!peer.hasPermission(Permission.MODERATE_CHAT))
					throw new Error('peer not authorized');

				room.chatHistory.length = 0;
				room.notifyPeers('moderator:clearChat', {});
				context.handled = true;

				break;
			}

			case 'moderator:clearFiles': {
				if (!peer.hasPermission(Permission.MODERATE_FILES))
					throw new Error('peer not authorized');

				room.fileHistory.length = 0;
				room.notifyPeers('moderator:clearFiles', {});
				context.handled = true;

				break;
			}

			case 'moderator:mute': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const mutePeer = room.peers.get(peerId);

				if (!mutePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				mutePeer.notify({ method: 'moderator:mute', data: {} });
				context.handled = true;

				break;
			}

			case 'moderator:muteAll': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:mute', {});
				context.handled = true;

				break;
			}

			case 'moderator:stopVideo': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const stopVideoPeer = room.peers.get(peerId);

				if (!stopVideoPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				stopVideoPeer.notify({ method: 'moderator:stopVideo', data: {} });
				context.handled = true;

				break;
			}

			case 'moderator:stopAllVideo': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:stopVideo', {});
				context.handled = true;

				break;
			}

			case 'moderator:stopScreenSharing': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const stopVideoPeer = room.peers.get(peerId);

				if (!stopVideoPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				stopVideoPeer.notify({ method: 'moderator:stopScreenSharing', data: {} });
				context.handled = true;

				break;
			}

			case 'moderator:stopAllScreenSharing': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:stopScreenSharing', {});
				context.handled = true;

				break;
			}

			case 'moderator:closeMeeting': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:kick', {});
				room.close();
				context.handled = true;

				break;
			}

			case 'moderator:kickPeer': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const kickPeer = room.peers.get(peerId);

				if (!kickPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				kickPeer.notify({ method: 'moderator:kick', data: {} });
				kickPeer.close();
				context.handled = true;

				break;
			}

			case 'moderator:lowerHand': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const lowerPeer = room.peers.get(peerId);

				if (!lowerPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				lowerPeer.notify({ method: 'moderator:lowerHand', data: {} });
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