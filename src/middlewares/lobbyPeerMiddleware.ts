import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { verifyPeer } from '../common/token';
import { Permission, updatePeerPermissions } from '../common/authorization';

const logger = new Logger('LobbyPeerMiddleware');

export const createLobbyPeerMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createLobbyPeerMiddleware() [room: %s]', room.sessionId);

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
			case 'changeDisplayName': {
				const { displayName } = message.data;

				peer.displayName = displayName;
				room.notifyPeersWithPermission('lobby:changeDisplayName', {
					peerId: peer.id,
					displayName
				}, Permission.PROMOTE_PEER, peer);

				context.handled = true;

				break;
			}

			case 'changePicture': {
				const { picture } = message.data;

				peer.picture = picture;
				room.notifyPeersWithPermission('lobby:changePicture', {
					peerId: peer.id,
					picture
				}, Permission.PROMOTE_PEER, peer);

				context.handled = true;

				break;
			}

			case 'updateToken':
			{
				const { token } = message.data as { token?: string };

				let newManagedId: string | undefined;

				if (typeof token === 'undefined')
				{
					newManagedId = undefined;
				}
				else
				{
					const res = verifyPeer(token);

					if (!res.ok)
					{
						throw new Error(res.reason === 'expired' ? 'Token expired' : 'Invalid token');
					}
					else
					{
						newManagedId = res.managedId;
					}
				}

				room.setPeerManagedId(peer, newManagedId);

				updatePeerPermissions(room, peer, true);

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