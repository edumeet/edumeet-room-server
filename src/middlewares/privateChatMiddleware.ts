import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { DirectChatMessage } from '../common/types';
import { isValidText, MAX_CHAT_MESSAGE_LENGTH } from '../common/textValidation';
import { PeerContext } from '../Peer';
import Room from '../Room';

const logger = new Logger('PrivateChatMiddleware');

export const createPrivateChatMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createPrivateChatMiddleware() [room: %s]', room.sessionId);

	// Deliberately not session scoped: a direct message follows the peer, so it is
	// always handled by the parent room, also when either peer sits in a breakout room.
	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
		} = context;

		switch (message.method) {
			case 'privateChatMessage': {
				if (!peer.hasPermission(Permission.SEND_CHAT))
					throw new Error('peer not authorized');

				const { text, to } = message.data;

				if (!isValidText(text, MAX_CHAT_MESSAGE_LENGTH))
					throw new Error('invalid message');

				if (!to || to === peer.id)
					throw new Error('invalid recipient');

				const recipient = room.getPeerById(to);

				if (!recipient)
					throw new Error('peer not found');

				const chatMessage = {
					text,
					peerId: peer.id,
					to,
					displayName: peer.displayName,
					timestamp: Date.now(),
				} as DirectChatMessage;

				recipient.notify({ method: 'privateChatMessage', data: { chatMessage } });

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
