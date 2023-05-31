import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { verifyPeer } from '../common/token';

const logger = new Logger('PeerMiddleware');

export const createPeerMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createPeerMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
		} = context;
		
		switch (message.method) {
			case 'changeDisplayName': {
				const { displayName } = message.data;

				peer.displayName = displayName;

				room.notifyPeers('changeDisplayName', {
					peerId: peer.id,
					displayName
				}, peer);

				context.handled = true;

				break;
			}

			case 'changePicture': {
				const { picture } = message.data;

				peer.picture = picture;

				room.notifyPeers('changePicture', {
					peerId: peer.id,
					picture
				}, peer);

				context.handled = true;

				break;
			}

			case 'raisedHand': {
				const { raisedHand } = message.data;

				peer.raisedHand = raisedHand;

				room.notifyPeers('raisedHand', {
					peerId: peer.id,
					raisedHand,
					raisedHandTimestamp: peer.raisedHandTimestamp
				}, peer);

				context.handled = true;

				break;
			}

			case 'escapeMeeting': {
				const { escapeMeeting } = message.data;

				peer.escapeMeeting = escapeMeeting;

				if (escapeMeeting) {
					if (!room.peers.items.some((p) => !p.escapeMeeting)) {
						room.notifyPeers('escapeMeeting', {});

						room.close();
					}
				}

				context.handled = true;

				break;
			}

			case 'updateToken': {
				const { token } = message.data;
				const managedId = token ? verifyPeer(token) : undefined;

				peer.managedId = managedId;
				room.updatePeerPermissions(peer);

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