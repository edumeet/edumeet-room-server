import { Socket } from 'socket.io';
import { Logger } from 'edumeet-common';
import { IOServerConnection } from './IOServerConnection';

const logger = new Logger('socketHandler');

export const socketHandler = (socket: Socket) => {
	const {
		roomId,
		peerId,
		displayName,
		token,
	} = socket.handshake.query;

	logger.debug(
		'socketHandler() - socket connection [socketId: %s, roomId: %s, peerId: %s]',
		socket.id,
		roomId,
		peerId
	);

	if (!roomId || !peerId) {
		logger.warn('socketHandler() - socket invalid roomId or peerId');

		return socket.disconnect(true);
	}

	const origin = socket.handshake.headers.origin;

	if (!origin) {
		logger.warn('socketHandler() - socket no origin');

		return socket.disconnect(true);
	}

	let clientHost = '';

	try {
		clientHost = new URL(origin).hostname;
	} catch {
		logger.warn('socketHandler() - socket error parsing origin');

		return socket.disconnect(true);
	}

	const socketConnection = new IOServerConnection(socket);

	try {
		serverManager.handleConnection(
			socketConnection,
			peerId as string,
			roomId as string,
			clientHost as string,
			displayName as string,
			token as string,
		);
	} catch (error) {
		logger.warn({ err: error }, 'socketHandler() - handleConnection() [error: %o]');

		socketConnection.close();
	}
};
