import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';

const logger = new Logger('E2eeMiddleware');

// Opaque relay for end-to-end-encryption key exchange. The server NEVER reads key material — it only
// forwards `e2eeIdentity` (broadcast, or targeted to one peer) and `e2eeKey` (always targeted), and
// stamps the authoritative sender id so a peer can't spoof another's identity/key.
export const createE2eeMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createE2eeMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (context, next) => {
		const { peer, message } = context;

		switch (message.method) {
			case 'e2eeIdentity': {
				const { toPeerId } = message.data;
				const data = { ...message.data, peerId: peer.id };

				delete data.toPeerId;

				if (toPeerId)
					room.getPeerById(toPeerId)?.notify({ method: 'e2eeIdentity', data });
				else
					room.notifyPeers('e2eeIdentity', data, peer);

				context.handled = true;

				break;
			}

			case 'e2eeKey': {
				const { toPeerId } = message.data;
				const data = { ...message.data, fromPeerId: peer.id };

				delete data.toPeerId;

				room.getPeerById(toPeerId)?.notify({ method: 'e2eeKey', data });

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
