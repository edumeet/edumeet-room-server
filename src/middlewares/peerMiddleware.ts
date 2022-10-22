import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
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
		// None of these are allowed in a room with a parent
		if (room.parent)
			return next();

		const {
			peer,
			message,
		} = context;
		
		switch (message.method) {
			case 'changeDisplayName': {
				const { displayName } = message.data;

				peer.displayName = displayName;

				room.notifyPeers('peerDisplayNameChanged', {
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

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};