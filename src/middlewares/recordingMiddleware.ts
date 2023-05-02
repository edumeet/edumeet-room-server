import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';

const logger = new Logger('RecordingMiddleware');

export const createRecordingMiddleware = ({
	room
}: MiddlewareOptions): Middleware<PeerContext> => {
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
				room.notifyPeers('recording:privacy', {
					peerId: peer.id
				}, peer);

				context.handled = true;

				break;
			}

			case 'recording:recordable': {
				const { recordable } = message.data;

				peer.recordable = recordable;

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