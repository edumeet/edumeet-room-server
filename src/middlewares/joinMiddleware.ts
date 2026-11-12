import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { createConsumers } from '../common/consuming';
import { displayNameText, isValidPicture } from '../common/textValidation';
import { roomStateSent } from '../common/suspiciousClients';

const logger = new Logger('JoinMiddleware');

export const createJoinMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createJoinMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response
		} = context;

		if (!thisSession(room, message)) return next();

		switch (message.method) {
			case 'join': {
				const {
					displayName,
					picture,
				} = message.data;

				const name = displayNameText(displayName);

				if (name !== undefined) peer.displayName = name;
				if (isValidPicture(picture)) peer.picture = picture;

				response.peers = room.getPeers().map((p) => (p.peerInfo));
				response.chatHistory = room.chatHistory;
				response.fileHistory = room.fileHistory;
				response.countdownTimer = room.countdownTimer;
				response.drawing = room.drawing;
				response.breakoutRooms = room.getBreakoutRooms().map((b) => (b.breakoutRoomInfo));
				response.locked = room.locked;
				// Torrent tracker for fileService (do not use DHT or the files will be visible)
				if (room.maxFileSize)
					response.maxFileSize = room.maxFileSize;
				if (room.tracker)
					response.tracker = room.tracker;

				room.joinPeer(peer);
				roomStateSent(peer);
				context.handled = true;

				if (peer.closed) break;

				// Read after joinPeer(): joining can make the peer moderator, when the last one left
				// while it was on its way in, and the client replaces its lobby list with this one
				response.lobbyPeers = peer.hasPermission(Permission.PROMOTE_PEER) ?
					room.lobbyPeers.items.map((p) => (p.peerInfo)) : [];

				// The session the peer is actually in; a bot may have been placed in a breakout.
				response.sessionId = peer.sessionId;

				if (!peer.headless && room.managedId && room.botProviders.length > 0) {
					response.botProviders = room.botJobs.providers();
					response.botJobs = room.botJobs.inSession(peer.sessionId);
				}

				if (!peer.initialConsume && peer.consumingTransport) {
					peer.initialConsume = true;

					createConsumers(room, peer);
				}

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
