import { Logger, Middleware } from 'edumeet-common';
import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { FileMessage, MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('FileMiddleware');

export const createFileMiddleware = ({
	room,
	fileHistory,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createFileMiddleware() [room: %s]', room.id);

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
			case 'sendFile': {
				if (!hasPermission(room, peer, Permission.SHARE_FILE))
					throw new Error('peer not authorized');

				const { magnetURI } = message.data;
				const file = {
					magnetURI,
					peerId: peer.id,
					displayName: peer.displayName,
					timestamp: Date.now()
				} as FileMessage;

				fileHistory.push(file);

				room.notifyPeers('sendFile', {
					peerId: peer.id,
					file,
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