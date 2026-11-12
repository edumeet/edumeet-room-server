import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { verifyPeer } from '../common/token';
import { updatePeerPermissions } from '../common/authorization';
import { displayNameText, isValidPicture, isValidReaction } from '../common/textValidation';

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
				const displayName = displayNameText(message.data.displayName);

				if (displayName === undefined)
					throw new Error('invalid display name');

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

				if (!isValidPicture(picture))
					throw new Error('invalid picture');

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

				if (typeof raisedHand !== 'boolean')
					throw new Error('invalid raisedHand');

				peer.raisedHand = raisedHand;

				room.notifyPeers('raisedHand', {
					peerId: peer.id,
					raisedHand,
					raisedHandTimestamp: peer.raisedHandTimestamp
				}, peer);

				context.handled = true;

				break;
			}

			case 'reaction': {
				const { reaction } = message.data;

				if (!room.reactionsEnabled)
					throw new Error('reactions disabled');

				if (!isValidReaction(reaction))
					throw new Error('invalid reaction');

				peer.sendReaction = reaction;

				room.notifyPeers('reaction', {
					peerId: peer.id,
					reaction,
					sendReactionTimestamp: peer.sendReactionTimestamp
				}, peer);

				context.handled = true;

				break;
			}

			case 'recording': {
				const { recording } = message.data;

				if (typeof recording !== 'boolean')
					throw new Error('invalid recording');

				peer.recording = recording;

				room.notifyPeers('recording', {
					peerId: peer.id,
					recording
				}, peer);

				context.handled = true;

				break;
			}

			case 'escapeMeeting': {
				const { escapeMeeting } = message.data;

				if (typeof escapeMeeting !== 'boolean')
					throw new Error('invalid escapeMeeting');

				peer.escapeMeeting = escapeMeeting;

				if (escapeMeeting) {
					if (!room.participants.some((p) => !p.escapeMeeting)) {
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

				peer.setManagedId(managedId);

				updatePeerPermissions(room, peer);

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
