import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { FileMessage } from '../common/types';
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

				room.fileHistory = room.fileHistory.filter((item: FileMessage) => {
					// user can only drop own files
					return (!(magnetURI == item.magnetURI && item.peerId == peer.id));
				}) as FileMessage[];

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