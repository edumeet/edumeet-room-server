import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { FileMessage } from '../common/types';
import { isValidMagnetUri, magnetInfoHashes } from '../common/textValidation';
import { PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

const logger = new Logger('FileMiddleware');

const sharedByOthers = (history: FileMessage[], magnetURI: string, peerId: string): boolean => {
	const hashes = magnetInfoHashes(magnetURI);

	return history.some((item) => item.peerId !== peerId &&
		(item.magnetURI === magnetURI || magnetInfoHashes(item.magnetURI).some((h) => hashes.includes(h))));
};

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

				// Clients remove a file by its torrent, so a file another peer shared must not be
				// shared again under a second owner, who could then clear it for everyone.
				if (sharedByOthers(room.fileHistory, magnetURI, peer.id))
					throw new Error('file already shared');

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

				if (!isValidMagnetUri(magnetURI))
					throw new Error('invalid magnetURI');

				const moderator = peer.hasPermission(Permission.MODERATE_FILES);
				const hashes = magnetInfoHashes(magnetURI);
				const cleared = room.fileHistory.filter((item: FileMessage) =>
					item.magnetURI === magnetURI || magnetInfoHashes(item.magnetURI).some((h) => hashes.includes(h)));

				// The clients drop the torrent for everyone, so only a moderator, or the owner of
				// every entry for it, may ask.
				if (cleared.length === 0 || (!moderator && cleared.some((item) => item.peerId !== peer.id)))
					throw new Error('peer not authorized');

				room.fileHistory = room.fileHistory.filter((item: FileMessage) => !cleared.includes(item));

				// Clients match the link as it was shared, which may be written otherwise than here.
				for (const link of new Set(cleared.map((item) => item.magnetURI)))
					room.notifyPeers('clearFile', { magnetURI: link });

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