import { Socket } from 'socket.io';
import { Logger } from 'edumeet-common';
import { IOServerConnection } from './IOServerConnection';

const logger = new Logger('socketHandler');

export const socketHandler = (socket: Socket) => {
	const {
		roomId,
		peerId,
		tenantId,
		displayName,
		token,
		reconnectKey,
	} = socket.handshake.query;

	logger.debug(
		'socket connection [socketId: %s, roomId: %s, peerId: %s, tenantId: %s, reconnectKey: %s]',
		socket.id,
		roomId,
		peerId,
		tenantId,
		reconnectKey,
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
			tenantId as number | undefined,
			displayName as string,
			token as string,
			reconnectKey as string | undefined,
		);
	} catch (error) {
		logger.warn({ err: error }, 'handleConnection() [error: %o]');

		socketConnection.close();
	}
};
