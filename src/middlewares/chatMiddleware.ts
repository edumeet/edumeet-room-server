import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { ChatMessage } from '../common/types';
import { chatText } from '../common/textValidation';
import { addressOf, limitHit } from '../common/suspiciousClients';
import { addChatMessage } from '../common/history';
import { PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

const logger = new Logger('ChatMiddleware');

// inReconnectState: the chat history of this room is part of what a reconnecting peer gets, as
// the main room's is and a breakout room's is not. Then a message is not kept for recovery.
export const createChatMiddleware = (
	{ room, inReconnectState = false }: { room: Room | BreakoutRoom; inReconnectState?: boolean; }
): Middleware<PeerContext> => {
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
				if (!peer.hasPermission(Permission.SEND_CHAT))
					throw new Error('peer not authorized');

				const text = chatText(message.data.text);

				if (text === undefined)
					throw new Error('invalid message');

				if (!peer.chatMessages.take()) {
					limitHit(addressOf(peer));

					throw new Error('Too many messages');
				}

				const chatMessage = {
					text,
					peerId: peer.id,
					displayName: peer.displayName,
					timestamp: Date.now(),
					sessionId: room.sessionId,
				} as ChatMessage;

				addChatMessage(room.chatHistory, chatMessage);

				if (inReconnectState) (room as Room).notifyPeersOnce('chatMessage', { peerId: peer.id, chatMessage }, peer);
				else room.notifyPeers('chatMessage', { peerId: peer.id, chatMessage }, peer);

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