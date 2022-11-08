import { hasPermission, Permission, userRoles } from '../common/authorization';
import { PeerContext } from '../Peer';
import { MiddlewareOptions } from '../common/types';
import { thisSession } from '../common/checkSessionId';
import { Logger, Middleware } from 'edumeet-common';

const logger = new Logger('ModeratorMiddleware');

export const createModeratorMiddleware = ({
	room,
	chatHistory,
	fileHistory,
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createModeratorMiddleware() [room: %s]', room.id);

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
			case 'moderator:giveRole': {
				if (!hasPermission(room, peer, Permission.MODIFY_ROLE))
					throw new Error('peer not authorized');

				const { peerId, roleId } = message.data;
				const userRole = Object.values(userRoles).find((role) => role.id === roleId);

				if (!userRole || !userRole.promotable)
					throw new Error('no such role');

				if (!peer.roles.some((role) => role.level >= userRole.level))
					throw new Error('peer not authorized for this level');

				const giveRolePeer = room.peers.get(peerId);

				if (!giveRolePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				const hadPromotePermission =
					hasPermission(room, giveRolePeer, Permission.PROMOTE_PEER);

				giveRolePeer.addRole(userRole);
				room.notifyPeers('gotRole', { peerId: peer.id, roleId: userRole.id });

				if (
					!room.lobbyPeers.empty &&
					!hadPromotePermission &&
					hasPermission(room, giveRolePeer, Permission.PROMOTE_PEER)
				) {
					const lobbyPeers = room.lobbyPeers.items.map((p) => (p.peerInfo));

					giveRolePeer.notify({ method: 'parkedPeers', data: { lobbyPeers } });
				}

				context.handled = true;

				break;
			}

			case 'moderator:removeRole': {
				if (!hasPermission(room, peer, Permission.MODIFY_ROLE))
					throw new Error('peer not authorized');

				const { peerId, roleId } = message.data;
				const userRole = Object.values(userRoles).find((role) => role.id === roleId);

				if (!userRole || !userRole.promotable)
					throw new Error('no such role');

				if (!peer.roles.some((role) => role.level >= userRole.level))
					throw new Error('peer not authorized for this level');

				const removeRolePeer = room.peers.get(peerId);

				if (!removeRolePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				removeRolePeer.removeRole(userRole);

				room.notifyPeers('lostRole', {
					peerId: peer.id,
					roleId: userRole.id
				});

				context.handled = true;

				break;
			}

			case 'moderator:clearChat': {
				if (!hasPermission(room, peer, Permission.MODERATE_CHAT))
					throw new Error('peer not authorized');

				chatHistory.length = 0;
				room.notifyPeers('moderator:clearChat', {});
				context.handled = true;

				break;
			}

			case 'moderator:clearFiles': {
				if (!hasPermission(room, peer, Permission.MODERATE_FILES))
					throw new Error('peer not authorized');

				fileHistory.length = 0;
				room.notifyPeers('moderator:clearFiles', {});
				context.handled = true;

				break;
			}

			case 'moderator:mute': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const mutePeer = room.peers.get(peerId);

				if (!mutePeer)
					throw new Error(`peer with id "${peerId}" not found`);

				mutePeer.notify({ method: 'moderator:mute', data: {} });
				context.handled = true;

				break;
			}

			case 'moderator:muteAll': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:mute', {});
				context.handled = true;

				break;
			}

			case 'moderator:stopVideo': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const stopVideoPeer = room.peers.get(peerId);

				if (!stopVideoPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				stopVideoPeer.notify({ method: 'moderator:stopVideo', data: {} });
				context.handled = true;

				break;
			}

			case 'moderator:stopAllVideo': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:stopVideo', {});
				context.handled = true;

				break;
			}

			case 'moderator:stopScreenSharing': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const stopVideoPeer = room.peers.get(peerId);

				if (!stopVideoPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				stopVideoPeer.notify({ method: 'moderator:stopScreenSharing', data: {} });
				context.handled = true;

				break;
			}

			case 'moderator:stopAllScreenSharing': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:stopScreenSharing', {});
				context.handled = true;

				break;
			}

			case 'moderator:closeMeeting': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				room.notifyPeers('moderator:kick', {});
				room.close();
				context.handled = true;

				break;
			}

			case 'moderator:kickPeer': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const kickPeer = room.peers.get(peerId);

				if (!kickPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				kickPeer.notify({ method: 'moderator:kick', data: {} });
				kickPeer.close();
				context.handled = true;

				break;
			}

			case 'moderator:lowerHand': {
				if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const { peerId } = message.data;
				const lowerPeer = room.peers.get(peerId);

				if (!lowerPeer)
					throw new Error(`peer with id "${peerId}" not found`);

				lowerPeer.notify({ method: 'moderator:lowerHand', data: {} });
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