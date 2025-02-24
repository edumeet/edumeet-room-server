import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { Peer, PeerContext } from '../Peer';
import BreakoutRoom from '../BreakoutRoom';
import { createConsumers } from '../common/consuming';
import Room from '../Room';

const logger = new Logger('BreakoutMiddleware');

export const createBreakoutMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createBreakoutMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response,
		} = context;

		if (!thisSession(room, message)) return next();
		
		switch (message.method) {
			case 'createBreakoutRoom': {
				if (!peer.hasPermission(Permission.CREATE_ROOM))
					throw new Error('peer not authorized');

				const { name } = message.data;

				if (!name) throw new Error('name not provided');

				const newBreakoutRoom = new BreakoutRoom({ parent: room, name });

				room.breakoutRooms.set(newBreakoutRoom.sessionId, newBreakoutRoom);
				newBreakoutRoom.once('close', () => room.breakoutRooms.delete(newBreakoutRoom.sessionId));
				room.notifyPeers('newBreakoutRoom', { name, roomSessionId: newBreakoutRoom.sessionId, creationTimestamp: newBreakoutRoom.creationTimestamp }, peer);

				response.sessionId = newBreakoutRoom.sessionId;
				response.creationTimestamp = newBreakoutRoom.creationTimestamp;
				context.handled = true;

				break;
			}

			case 'ejectBreakoutRoom': {
				if (!peer.hasPermission(Permission.CREATE_ROOM))
					throw new Error('peer not authorized');

				const { roomSessionId } = message.data;
				const roomToEmpty = room.breakoutRooms.get(roomSessionId);

				if (!roomToEmpty)
					throw new Error('BreakoutRoom not found');

				roomToEmpty.getPeers().forEach((p) => changeRoom(room, p, true));
				roomToEmpty.emptyRoom();

				context.handled = true;

				break;
			}

			case 'removeBreakoutRoom': {
				if (!peer.hasPermission(Permission.CREATE_ROOM))
					throw new Error('peer not authorized');

				const { roomSessionId } = message.data;
				const roomToClose = room.breakoutRooms.get(roomSessionId);

				if (!roomToClose)
					throw new Error('BreakoutRoom not found');

				roomToClose.getPeers().forEach((p) => changeRoom(room, p, true));
				roomToClose.close();
				room.notifyPeers('breakoutRoomClosed', { roomSessionId }, peer);

				context.handled = true;

				break;
			}

			case 'joinBreakoutRoom': {
				if (!peer.hasPermission(Permission.CHANGE_ROOM))
					throw new Error('peer not authorized');

				const { roomSessionId } = message.data;

				if (peer.sessionId === roomSessionId)
					throw new Error('Already in session');

				const roomToJoin = room.breakoutRooms.get(roomSessionId);

				if (!roomToJoin)
					throw new Error('Session not found');

				roomToJoin.addPeer(peer);

				changeRoom(roomToJoin, peer);

				response.chatHistory = roomToJoin.chatHistory;
				response.fileHistory = roomToJoin.fileHistory;
				context.handled = true;

				break;
			}

			case 'leaveBreakoutRoom': {
				if (!peer.hasPermission(Permission.CHANGE_ROOM))
					throw new Error('peer not authorized');

				if (peer.sessionId === room.sessionId)
					throw new Error('Already in parent');

				changeRoom(room, peer);

				response.sessionId = room.sessionId;
				context.handled = true;

				break;
			}

			case 'moveToBreakoutRoom': {
				const { roomSessionId, roomPeerId } = message.data;

				const roomToBeMovedTo = room.breakoutRooms.get(roomSessionId);
				const peerToBeMoved = room.getPeerById(roomPeerId);

				if (!peerToBeMoved)
					throw new Error('Peer not found');

				if (!roomToBeMovedTo)
					throw new Error('Session not found');
				
				if (peerToBeMoved.sessionId === roomSessionId)
					throw new Error('Already in session');

				roomToBeMovedTo.addPeer(peerToBeMoved);

				changeRoom(roomToBeMovedTo, peerToBeMoved);

				response.chatHistory = roomToBeMovedTo.chatHistory;
				response.fileHistory = roomToBeMovedTo.fileHistory;
				context.handled = true;

				break;
			}

			default: {
				break;
			}
		}

		return next();
	};

	const changeRoom = (roomToJoin: Room | BreakoutRoom, peer: Peer, messagePeer = false) => {
		const roomToLeave = room.breakoutRooms.get(peer.sessionId);

		roomToLeave?.removePeer(peer);
		room.notifyPeers('changeSessionId', { peerId: peer.id, sessionId: roomToJoin.sessionId, oldSessionId: peer.sessionId }, peer);
		peer.closeProducers();

		// This will trigger the consumers of peers not in the room to be closed
		peer.sessionId = roomToJoin.sessionId;

		if (messagePeer)
			peer.notify({ method: 'sessionIdChanged', data: { sessionId: roomToJoin.sessionId } });

		// Create consumers for the peer in the new room
		createConsumers(room, peer);
	};

	return middleware;
};