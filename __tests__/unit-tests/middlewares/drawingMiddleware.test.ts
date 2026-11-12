import 'jest';
import { createDrawingMiddleware } from '../../../src/middlewares/drawingMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import {
	ByteBudget,
	Throttle,
	WHITEBOARD_BURST_BYTES,
	WHITEBOARD_BYTES_PER_SECOND,
	WHITEBOARD_MOVE_BYTES_PER_SECOND,
	WHITEBOARD_MOVE_INTERVAL_MS,
} from '../../../src/common/rateLimiter';

const makeRoom = (ids: number[], whiteboardBytes = new ByteBudget(WHITEBOARD_BURST_BYTES, WHITEBOARD_BYTES_PER_SECOND)) => ({
	peer: {
		id: 'drawer',
		connections: { items: [] },
		whiteboardBytes,
		whiteboardMoves: new Throttle(WHITEBOARD_MOVE_INTERVAL_MS, WHITEBOARD_MOVE_BYTES_PER_SECOND),
	},
	sessionId: 's1',
	notifyPeers: jest.fn(),
	notifyPeersOnce: jest.fn(),
	drawing: {
		isEnabled: true,
		bgColor: '#fff',
		canvasState: ids.map((id) => ({ objectId: id, object: { type: 'Path', id }, status: 'added' })),
	},
});

const send = async (room: ReturnType<typeof makeRoom>, method: string, data: Record<string, unknown> = {}) => {
	const context = { peer: room.peer, message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

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

test('A change to an object the room does not have is not passed on; a real change is', async () => {
	const room = makeRoom([ 1 ]);

	await send(room, 'updateCanvasState', { status: 'modified', object: { type: 'Path', id: 99 } });
	await send(room, 'updateCanvasState', { status: 'removed', object: { type: 'Path', id: 99 } });

	expect(room.notifyPeers).not.toHaveBeenCalled();

	await send(room, 'updateCanvasState', { status: 'modified', object: { type: 'Path', id: 1, left: 3 } });
	await send(room, 'updateCanvasState', { status: 'added', object: { type: 'Path', id: 2 } });
	await send(room, 'updateCanvasState', { status: 'removed', object: { type: 'Path', id: 1 } });

	expect(room.notifyPeers).toHaveBeenCalledTimes(3);
});

test('What a peer sends to the whiteboard comes out of its budget; over it, nothing is stored or passed on', async () => {
	const object = (id: number) => ({ type: 'Path', id });
	const size = JSON.stringify(object(1)).length;
	const room = makeRoom([], new ByteBudget(2 * size, 0));

	await send(room, 'updateCanvasState', { status: 'added', object: object(1) });
	await send(room, 'updateCanvasState', { status: 'added', object: object(2) });
	await expect(send(room, 'updateCanvasState', { status: 'added', object: object(3) })).rejects.toThrow('Too much whiteboard data');

	expect(storedIds(room)).toEqual([ 1, 2 ]);
	expect(room.notifyPeers).toHaveBeenCalledTimes(2);
});

// The client sends a dragged object on every pointer move; the end of the drag comes as 'modified'.
test('A dragged object is passed on at most every WHITEBOARD_MOVE_INTERVAL_MS, without being kept for recovery or counted', async () => {
	const room = makeRoom([ 1 ], new ByteBudget(0, 0));
	const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

	try {
		await send(room, 'updateCanvasState', { status: 'editing', object: { type: 'Path', id: 1, left: 1 } });
		await send(room, 'updateCanvasState', { status: 'editing', object: { type: 'Path', id: 1, left: 2 } });
		now.mockReturnValue(1_000_000 + WHITEBOARD_MOVE_INTERVAL_MS);
		await send(room, 'updateCanvasState', { status: 'lock', object: { type: 'Path', id: 1, left: 3 } });
		await send(room, 'updateCanvasState', { status: 'editing', object: { type: 'Path', id: 99 } });
		now.mockReturnValue(1_000_000 + (2 * WHITEBOARD_MOVE_INTERVAL_MS));
		await send(room, 'updateCanvasState', { status: 'editing', object: { type: 'Path', id: 99 } });
	} finally {
		now.mockRestore();
	}

	expect(room.notifyPeersOnce.mock.calls.map(([ , data ]) => data.action.object.left)).toEqual([ 1, 3 ]);
	expect(room.notifyPeers).not.toHaveBeenCalled();
	expect(room.drawing.canvasState[0].object).toEqual({ type: 'Path', id: 1 });
});

test('The larger a dragged object, the less often it is passed on', () => {
	const moves = new Throttle(WHITEBOARD_MOVE_INTERVAL_MS, WHITEBOARD_MOVE_BYTES_PER_SECOND);
	const large = WHITEBOARD_MOVE_BYTES_PER_SECOND / 2;

	expect(moves.pass(large, 0)).toBe(true);
	expect(moves.pass(10, 499)).toBe(false);
	expect(moves.pass(10, 500)).toBe(true);
	expect(moves.pass(10, 500 + WHITEBOARD_MOVE_INTERVAL_MS)).toBe(true);
});

test('A removal is not counted, and passes on what the room had without its eraser strokes', async () => {
	const erased = { type: 'Path', id: 1, path: [ [ 'M', 0, 0 ] ], clipPath: { type: 'clipping', objects: [] } };
	const room = makeRoom([], new ByteBudget(JSON.stringify(erased).length, 0));

	await send(room, 'updateCanvasState', { status: 'added', object: erased });
	await send(room, 'updateCanvasState', { status: 'removed', object: erased });

	expect(storedIds(room)).toEqual([]);
	expect(room.notifyPeers).toHaveBeenLastCalledWith(
		'updateCanvas', { action: { status: 'removed', object: { type: 'Path', id: 1, path: [ [ 'M', 0, 0 ] ] } } }, room.peer);
	await expect(send(room, 'updateCanvasState', { status: 'removed', object: erased })).rejects.toThrow('Too much whiteboard data');
});
