import 'jest';
import { createDrawingMiddleware } from '../../../src/middlewares/drawingMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';

const makeRoom = (ids: number[]) => ({
	sessionId: 's1',
	notifyPeers: jest.fn(),
	drawing: {
		isEnabled: true,
		bgColor: '#fff',
		canvasState: ids.map((id) => ({ objectId: id, object: { type: 'Path', id }, status: 'added' })),
	},
});

const send = async (room: ReturnType<typeof makeRoom>, method: string, data: Record<string, unknown> = {}) => {
	const context = { peer: {}, message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

	await createDrawingMiddleware({ room: room as unknown as Room })(context, jest.fn());

	return context;
};

const storedIds = (room: ReturnType<typeof makeRoom>) => room.drawing.canvasState.map((o) => o.objectId);

test('removing an object the room does not have leaves the stored drawing alone', async () => {
	const room = makeRoom([ 1, 2, 3 ]);

	await send(room, 'updateCanvasState', { status: 'removed', object: { type: 'Path', id: 99 } });

	expect(storedIds(room)).toEqual([ 1, 2, 3 ]);
});

test('modifying an object the room does not have leaves the stored drawing alone', async () => {
	const room = makeRoom([ 1, 2 ]);

	await send(room, 'updateCanvasState', { status: 'modified', object: { type: 'Path', id: 99 } });

	expect(storedIds(room)).toEqual([ 1, 2 ]);
	expect(Object.keys(room.drawing.canvasState)).toEqual([ '0', '1' ]);
});

test('known objects are still modified and removed', async () => {
	const room = makeRoom([ 1, 2, 3 ]);

	await send(room, 'updateCanvasState', { status: 'modified', object: { type: 'Path', id: 2, left: 5 } });
	await send(room, 'updateCanvasState', { status: 'removed', object: { type: 'Path', id: 1 } });

	expect(storedIds(room)).toEqual([ 2, 3 ]);
	expect(room.drawing.canvasState[0].object).toEqual({ type: 'Path', id: 2, left: 5 });
});

test('erasing all clears what a late joiner would get', async () => {
	const room = makeRoom([ 1, 2 ]);

	const context = await send(room, 'clearCanvas');

	expect(context.handled).toBe(true);
	expect(room.drawing.canvasState).toEqual([]);
	expect(room.notifyPeers).toHaveBeenCalledWith('clearCanvas', {}, context.peer);
});
