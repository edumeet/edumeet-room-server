import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { FileMessage } from '../common/types';
import { isValidMagnetUri } from '../common/textValidation';
import { PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

const logger = new Logger('FileMiddleware');

export const createFileMiddleware = ({ room }: { room: Room | BreakoutRoom; }): Middleware<PeerContext> => {
	logger.debug('createFileMiddleware() [room: %s]', room.sessionId);

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
				if (!peer.hasPermission(Permission.SHARE_FILE))
					throw new Error('peer not authorized');

				const { magnetURI } = message.data;

				if (!isValidMagnetUri(magnetURI))
					throw new Error('invalid magnetURI');

				const file = {
					magnetURI,
					peerId: peer.id,
					displayName: peer.displayName,
					timestamp: Date.now(),
					sessionId: room.sessionId,
				} as FileMessage;

				room.fileHistory.push(file);

				room.notifyPeers('sendFile', {
					peerId: peer.id,
					file,
				}, peer);

				context.handled = true;

				break;
			}
			case 'clearFile': {
				const { magnetURI } = message.data;
				const moderator = peer.hasPermission(Permission.MODERATE_FILES);
				const cleared = room.fileHistory.filter((item: FileMessage) =>
					item.magnetURI === magnetURI && (moderator || item.peerId === peer.id));

				// The clients drop the file for everyone, so only its owner or a moderator may ask.
				if (cleared.length === 0)
					throw new Error('peer not authorized');

				room.fileHistory = room.fileHistory.filter((item: FileMessage) => !cleared.includes(item));

				room.notifyPeers('clearFile', {
					magnetURI,
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