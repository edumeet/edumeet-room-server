import { Socket } from 'socket.io';
import { IOServerConnection, Logger } from 'edumeet-common';

const logger = new Logger('socketHandler');

export const socketHandler = (socket: Socket) => {
	const {
		roomId,
		peerId,
		displayName,
		token,
	} = socket.handshake.query;

	logger.debug(
		'socket connection [socketId: %s, roomId: %s, peerId: %s]',
		socket.id,
		roomId,
		peerId
	);

	if (!roomId || !peerId) {
		logger.warn('socket invalid roomId or peerId');

		return socket.disconnect(true);
	}

	const socketConnection = new IOServerConnection(socket);

	try {
		serverManager.handleConnection(
			socketConnection,
			peerId as string,
			roomId as string,
			displayName as string,
			token as string,
		);
	} catch (error) {
		logger.warn('handleConnection() [error: %o]', error);

		socketConnection.close();
	}
};