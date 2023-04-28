import { Logger, Middleware } from 'edumeet-common';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('PeerMiddleware');

export const createPeerMiddleware = ({
	room
}: MiddlewareOptions): Middleware<PeerContext> => {
	logger.debug('createPeerMiddleware() [room: %s]', room.id);

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

			// TODO: Fix raised hand for multiple rooms
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

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};