import { Logger, Middleware } from 'edumeet-common';
import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { CanvasObject } from '../common/types';
import { addressOf, limitHit } from '../common/suspiciousClients';
import {
	canvasObjectBytes,
	canvasStateBytes,
	isValidCanvasAction,
	objectBytes,
	MAX_CANVAS_BYTES,
	MAX_CANVAS_OBJECTS,
} from '../common/canvasValidation';

const logger = new Logger('DrawingMiddleware');

const BG_COLORS: unknown[] = [ 'white', 'black', 'gray' ];

const canvasBytes = (room: Room): number => canvasStateBytes(room.drawing.canvasState);

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
				// we don't have a permission for drawing, so no chcecking here
				// if (!peer.hasPermission(Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');

				room.drawing.isEnabled = true;
	
				room.notifyPeers('moderator:enabledDrawing', {}, peer);
		
				context.handled = true;
		
				break;
			}

			case 'disableDrawing':
			{
				// we don't have a permission for drawing, so no chcecking here
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
				// we don't have a permission for drawing, so no chcecking here
				// if (!peer.hasPermission(Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');

				const bgColor = message.data;

				// The colours the client offers. Clients send the colour again whenever theirs
				// changes, also when the change came from another peer, so forwarding anything
				// else or an unchanged value would bounce between clients without end.
				if (!BG_COLORS.includes(bgColor)) throw new Error('invalid background colour');

				response.bgColor = bgColor;

				if (room.drawing.bgColor !== bgColor) {
					room.drawing.bgColor = bgColor;

					room.notifyPeers('setDrawingBgColor', {
						bgColor: room.drawing.bgColor
					}, peer);
				}

				context.handled = true;
				
				break;
			}

			case 'updateCanvasState':
			{
				const canvasAction = message.data;

				if (!isValidCanvasAction(canvasAction)) throw new Error('invalid canvas object');

				const { status } = canvasAction;
				const canvasObject = {
					object: canvasAction.object,
					objectId: canvasAction.object.id,
					status,
				} as CanvasObject;
				const bytes = canvasObjectBytes(canvasAction.object);
				// Index -1 would set a stray array property, and splice(-1, 1) remove the last object.
				const index = status == 'added' ? -1 : room.drawing.canvasState.findIndex((obj) => obj.objectId == canvasAction.object.id);
				// The clients ignore changes to objects they do not have, as the room does.
				const known = status == 'added' || index !== -1;

				response.canvasAction = canvasAction;
				context.handled = true;

				if (status == 'editing' || status == 'lock') {
					// Sent on every pointer move while an object is dragged; the end of the drag comes
					// as 'modified'. Out of date at once, so passed on less often and not kept for recovery.
					if (known && peer.whiteboardMoves.pass(bytes))
						room.notifyPeersOnce('updateCanvas', { action: canvasAction }, peer);

					break;
				}

				// A removal passes on what the room had, which was counted when it came.
				if (!(status == 'removed' && known) && !peer.whiteboardBytes.take(bytes)) {
					limitHit(addressOf(peer));

					throw new Error('Too much whiteboard data');
				}

				if (!known) break;

				if (status == 'added') {
					if (room.drawing.canvasState.length >= MAX_CANVAS_OBJECTS || canvasBytes(room) + bytes > MAX_CANVAS_BYTES)
						throw new Error('canvas full');

					objectBytes.set(canvasObject, bytes);
					room.drawing.canvasState.push(canvasObject);
					room.notifyPeers('updateCanvas', { action: canvasAction }, peer);
				} else if (status == 'modified') {
					const previous = room.drawing.canvasState[index];

					if (canvasBytes(room) - (objectBytes.get(previous) ?? canvasObjectBytes(previous.object)) + bytes > MAX_CANVAS_BYTES)
						throw new Error('canvas full');

					objectBytes.set(canvasObject, bytes);
					room.drawing.canvasState[index] = canvasObject;
					room.notifyPeers('updateCanvas', { action: canvasAction }, peer);
				} else {
					const [ removed ] = room.drawing.canvasState.splice(index, 1);
					// The clients remove by id, and the eraser strokes are most of an erased object.
					const object = { ...removed.object } as Record<string, unknown>;

					delete object.clipPath;
					room.notifyPeers('updateCanvas', { action: { object, status } }, peer);
				}

				break;
			}
			case 'clearCanvas':
			{
				// The client erases all without sending a 'removed' per object, so late joiners would get it all back.
				room.drawing.canvasState = [];

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