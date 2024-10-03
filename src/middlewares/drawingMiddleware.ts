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

			case 'enableDrawing':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
				
				room.drawing.isEnabled = true;
	
				room.notifyPeers('moderator:enabledDrawing', {}, peer);
		
				context.handled = true;				
		
				break;
			}

			case 'disableDrawing':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
		
				room.drawing.isEnabled = false;
		
				room.notifyPeers('disabledDrawing', {}, peer);
			
				context.handled = true;				
			
				break;
			}
				
			case 'setDrawingBgColor':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
			
				const bgColor = message.data;
				
				room.drawing.bgColor = bgColor;
			
				room.notifyPeers('settedDrawingBgColor', {
					bgColor: room.drawing.bgColor
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