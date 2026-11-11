import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { FileMessage } from '../common/types';
import { isValidMagnetUri, magnetInfoHashes } from '../common/textValidation';
import { PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import Room from '../Room';

const logger = new Logger('FileMiddleware');

// A sharer who left cannot be harmed by a second owner any more, and a reload gives the same
// person a new peer id: only entries of peers still in the room protect a file.
const isHere = (room: Room | BreakoutRoom, peerId: string): boolean =>
	room.peers.items.some((p) => p.id === peerId);

const sameFile = (item: FileMessage, magnetURI: string, hashes: string[]): boolean =>
	item.magnetURI === magnetURI || magnetInfoHashes(item.magnetURI).some((h) => hashes.includes(h));

const sharedByOthers = (room: Room | BreakoutRoom, magnetURI: string, peerId: string): boolean => {
	const hashes = magnetInfoHashes(magnetURI);

	return room.fileHistory.some((item) => item.peerId !== peerId && isHere(room, item.peerId) && sameFile(item, magnetURI, hashes));
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
				if (sharedByOthers(room, magnetURI, peer.id))
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
				const cleared = room.fileHistory.filter((item: FileMessage) => sameFile(item, magnetURI, hashes));

				// The clients drop the torrent for everyone, so only a moderator, or the owner of
				// every entry for it that a peer still in the room shared, may ask.
				if (cleared.length === 0 || (!moderator && cleared.some((item) => item.peerId !== peer.id && isHere(room, item.peerId))))
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