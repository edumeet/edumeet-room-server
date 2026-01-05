import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { verifyPeer } from '../common/token';
import { updatePeerPermissions } from '../common/authorization';

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

			case 'reaction': {
				const { reaction } = message.data;

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

			case 'updateToken':
			{
				const { token } = message.data as { token?: string };

				let newManagedId: string | undefined;

				if (typeof token === 'undefined')
				{
					// Logout path
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
