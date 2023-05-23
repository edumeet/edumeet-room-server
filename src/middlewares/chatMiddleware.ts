import { Logger, Middleware } from 'edumeet-common';
import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { ChatMessage } from '../common/types';
import { PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

const logger = new Logger('ChatMiddleware');

export const createChatMiddleware = ({ room }: { room: Room | BreakoutRoom; }): Middleware<PeerContext> => {
	logger.debug('createChatMiddleware() [room: %s]', room.sessionId);

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
			case 'chatMessage': {
				if (!hasPermission(room, peer, Permission.SEND_CHAT))
					throw new Error('peer not authorized');

				const { text } = message.data;
				const chatMessage = {
					text,
					peerId: peer.id,
					displayName: peer.displayName,
					timestamp: Date.now(),
					sessionId: room.sessionId,
				} as ChatMessage;

				room.chatHistory.push(chatMessage);

				room.notifyPeers({ method: 'chatMessage',
					data: {
						peerId: peer.id,
						chatMessage,
					},
					excludePeer: peer
				});

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