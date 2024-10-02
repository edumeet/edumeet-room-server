import { Permission } from '../common/authorization';
import { PeerContext } from '../Peer';
// import { thisSession } from '../common/checkSessionId';
import { Logger, Middleware } from 'edumeet-common';
// import moment from 'moment';
import Room from '../Room';

const logger = new Logger('DrawingMiddleware');

export const createDrawingMiddleware = ({ room }: { room: Room }): Middleware<PeerContext> => {
	logger.debug('createDrawingMiddleware() [room: %s]', room.id);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
		} = context;

		// if (!thisSession(room, message))
		// 	return next();
		
		switch (message.method) {

			case 'moderator:enableDrawing':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
				
				room.drawing.isEnabled = true;
	
				room.notifyPeers('moderator:enabledDrawing', {
					isEnabled: room.drawing.isEnabled
				}, peer);
		
				context.handled = true;				
		
				break;
			}

			case 'moderator:disableDrawing':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
		
				room.drawing.isEnabled = false;
		
				room.notifyPeers('moderator:disabledDrawing', {
					isEnabled: room.drawing.isEnabled
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