import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';

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

				room.notifyPeers({ method: 'changeDisplayName',
					data: {
						peerId: peer.id,
						displayName
					},
					excludePeer: peer });

				context.handled = true;

				break;
			}

			case 'changePicture': {
				const { picture } = message.data;

				peer.picture = picture;

				room.notifyPeers({ method: 'changePicture',
					data: {
						peerId: peer.id,
						picture
					},
					excludePeer: peer });

				context.handled = true;

				break;
			}

			case 'raisedHand': {
				const { raisedHand } = message.data;

				peer.raisedHand = raisedHand;

				room.notifyPeers({ method: 'raisedHand',
					data: {
						peerId: peer.id,
						raisedHand,
						raisedHandTimestamp: peer.raisedHandTimestamp
					},
					excludePeer: peer });

				context.handled = true;

				break;
			}

			case 'escapeMeeting': {
				const { escapeMeeting } = message.data;

				peer.escapeMeeting = escapeMeeting;

				if (escapeMeeting) {
					if (!room.peers.items.some((p) => !p.escapeMeeting)) {
						room.notifyPeers({ method: 'escapeMeeting', data: {} });

						room.close();
					}
				}

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