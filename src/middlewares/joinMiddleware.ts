import { Logger, Middleware } from 'edumeet-common';
import {
	hasPermission,
	Permission,
} from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { createConsumers } from '../common/consuming';
import { PeerContext } from '../Peer';
import Room from '../Room';

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

		if (!thisSession(room, message))
			return next();

		switch (message.method) {
			case 'join': {
				const {
					displayName,
					picture,
					rtpCapabilities,
				} = message.data;

				if (!rtpCapabilities)
					throw new Error('missing rtpCapabilities');

				peer.displayName = displayName;
				peer.picture = picture;
				peer.rtpCapabilities = rtpCapabilities;

				const lobbyPeers = hasPermission(room, peer, Permission.PROMOTE_PEER) ?
					room.lobbyPeers.items.map((p) => (p.peerInfo)) : [];

				response.peers = room.getPeers().map((p) => (p.peerInfo));
				response.chatHistory = room.chatHistory;
				response.fileHistory = room.fileHistory;
				response.breakoutRooms = room.getBreakoutRooms().map((b) => (b.breakoutRoomInfo));
				response.lobbyPeers = lobbyPeers;
				response.locked = room.locked;

				room.joinPeer(peer);
				context.handled = true;

				createConsumers(room, peer);

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