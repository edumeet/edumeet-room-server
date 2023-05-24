import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';

const logger = new Logger('RecordingMiddleware');

export const createRecordingMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createRecordingMiddleware() [room: %s]', room.id);

	const middleware: Middleware<PeerContext> = (
		context,
		next
	) => {
		const {
			peer,
			message
		} = context;

		if (!thisSession(room, message))
			return next();

		switch (message.method) {
			case 'recording:start': {
				room.notifyPeers('recording:permissions', {
					peerId: peer.id
				}, peer);

				context.handled = true;

				break;
			}

			case 'recording:recordable': {
				const { recordable } = message.data;

				peer.recordable = recordable;

				room.notifyPeers('recording:recordable', {
					peerId: peer.id,
					recordable: recordable
				}, peer);

				context.handled = true;

				break;
			}

			case 'recording:join': {
				const { peerId } = message.data;
				
				room.notifyPeers('recording:permissions', {
					peerId
				}, peer);

				context.handled = true;

				break;
			}

			case 'recording:stop': {
				room.notifyPeers('recording:stop', {
					peerId: peer.id
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