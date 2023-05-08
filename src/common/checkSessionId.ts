import { SocketMessage } from 'edumeet-common';
import Room from '../Room';
import BreakoutRoom from '../BreakoutRoom';

export const thisSession = (
	room: Room | BreakoutRoom,
	message: SocketMessage,
): boolean => {
	const { data: { sessionId } = {} } = message;

	if (room instanceof BreakoutRoom) {
		return room.sessionId === sessionId;
	}

	return (room.sessionId === sessionId) || !sessionId;
};