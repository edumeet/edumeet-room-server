import Room from '../Room';
import { SocketMessage } from '../signaling/SignalingInterface';

export const thisSession = (
	room: Room,
	message: SocketMessage,
): boolean => {
	const { data: { sessionId } = {} } = message;

	return (room.sessionId === sessionId) ||
		(!sessionId && !room.parent);
};