import { SocketMessage } from 'edumeet-common';
import Room from '../Room';

export const thisSession = (
	room: Room,
	message: SocketMessage,
): boolean => {
	const { data: { sessionId } = {} } = message;

	return (room.sessionId === sessionId) ||
		(!sessionId && !room.parent);
};