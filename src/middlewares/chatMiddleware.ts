import { Logger, Middleware } from 'edumeet-common';
import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { ChatMessage, MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('ChatMiddleware');

export const createChatMiddleware = ({
	room,
	chatHistory,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createChatMiddleware() [room: %s]', room.id);

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
					timestamp: Date.now()
				} as ChatMessage;

				chatHistory.push(chatMessage);

				room.notifyPeers('chatMessage', {
					peerId: peer.id,
					chatMessage,
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