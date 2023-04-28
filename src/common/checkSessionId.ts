import { SocketMessage } from 'edumeet-common';
import Room from '../Room';
import BreakoutRoom from '../BreakoutRoom';

export const thisSession = (
	room: Room | BreakoutRoom,
	message: SocketMessage,
): boolean => {
	const { data: { sessionId } = {} } = message;

	// TODO: this will match all if sessionId is undefined
	return (room.sessionId === sessionId) || !sessionId;
};