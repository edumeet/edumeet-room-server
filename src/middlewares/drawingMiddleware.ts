import { Logger, Middleware } from 'edumeet-common';
import { Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { CanvasObject } from '../common/types';

const logger = new Logger('DrawingMiddleware');

export const createDrawingMiddleware = ({ room }: { room: Room }): Middleware<PeerContext> => {
	logger.debug('createDrawingMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response,
		} = context;

		if (!thisSession(room, message)) {
			return next();
		}
		
		switch (message.method) {

			case 'enableDrawing':
			{

				// if (!peer.hasPermission(Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');

				room.drawing.isEnabled = true;
	
				room.notifyPeers('moderator:enabledDrawing', {}, peer);
		
				context.handled = true;
		
				break;
			}

			case 'disableDrawing':
			{
				// if (!peer.hasPermission(Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');
		
				room.drawing.isEnabled = false;
				room.drawing.canvasState = [];
		
				room.notifyPeers('disabledDrawing', {}, peer);
			
				context.handled = true;
			
				break;
			}

			case 'setDrawingBgColor':
			{

				// if (!peer.hasPermission(Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');

				const bgColor = message.data;
				
				response.bgColor = bgColor;
				room.drawing.bgColor = bgColor;
			
				room.notifyPeers('setDrawingBgColor', {
					bgColor: room.drawing.bgColor
				}, peer);
				
				context.handled = true;
				
				break;
			}

			case 'updateCanvasState':
			{
				const canvasAction = message.data;

				response.canvasAction = canvasAction;

				const canvasObject = {
					object: canvasAction.object,
					objectId: canvasAction.object.id,
					status: canvasAction.status,
				} as CanvasObject;

				if (canvasAction.status == 'added') {
					room.drawing.canvasState.push(canvasObject);
				} else if (canvasAction.status == 'modified') {
					const index = room.drawing.canvasState.findIndex((obj) => obj.objectId == canvasAction.object.id);
					
					room.drawing.canvasState[index] = canvasObject;
				} else if (canvasAction.status == 'removed') {
					const index = room.drawing.canvasState.findIndex((obj) => obj.objectId == canvasAction.object.id);
					
					room.drawing.canvasState.splice(index, 1);
				}

				room.notifyPeers('updateCanvas', {
					action: canvasAction
				}, peer);

				context.handled = true;

				break;
			}
			case 'clearCanvas': 
			{
				room.notifyPeers('clearCanvas', {}, peer);

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