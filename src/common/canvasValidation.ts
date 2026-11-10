// What the whiteboard sends: freehand paths and text, and the clipping group the eraser adds.
// Every client passes these objects to fabric, which loads images, patterns and filters itself,
// so anything else could make all participants' browsers fetch a URL of the sender's choice.
const OBJECT_TYPES = new Set([ 'Path', 'IText' ]);
const NESTED_TYPES = new Set([ 'Path', 'clipping' ]);
const RESOURCE_KEYS = new Set([ 'src', 'source', 'filters', 'resizeFilter', 'crossOrigin', 'backgroundImage', 'overlayImage' ]);
const STATUSES = new Set([ 'added', 'modified', 'removed', 'editing', 'lock' ]);
const MAX_DEPTH = 12;

// An erased object carries every eraser stroke, so one object may be as large as a socket.io message.
export const MAX_CANVAS_OBJECT_BYTES = 1_000_000;
export const MAX_CANVAS_OBJECTS = 2000;
export const MAX_CANVAS_BYTES = 10_000_000;

export interface CanvasAction {
	object: Record<string, unknown> & { id: string | number };
	status: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isNested = (value: unknown): boolean =>
	isPlainObject(value) && NESTED_TYPES.has(value.type as string);

const isSafe = (value: unknown, depth: number): boolean => {
	if (depth > MAX_DEPTH) return false;
	if (Array.isArray(value)) return value.every((item) => isSafe(item, depth + 1));
	if (!isPlainObject(value)) return true;

	for (const [ key, item ] of Object.entries(value)) {
		if (RESOURCE_KEYS.has(key)) return false;
		if ((key === 'fill' || key === 'stroke') && item !== null && item !== undefined && typeof item !== 'string') return false;
		if (key === 'clipPath' && item !== null && item !== undefined && !isNested(item)) return false;
		if (key === 'objects' && !(Array.isArray(item) && item.every(isNested))) return false;
		if (!isSafe(item, depth + 1)) return false;
	}

	return true;
};

export const canvasObjectBytes = (object: object): number => JSON.stringify(object).length;

export const isValidCanvasAction = (action: unknown): action is CanvasAction => {
	if (!isPlainObject(action) || !STATUSES.has(action.status as string)) return false;

	const { object } = action;

	if (!isPlainObject(object) || !OBJECT_TYPES.has(object.type as string)) return false;
	if (typeof object.id !== 'number' && typeof object.id !== 'string') return false;

	return canvasObjectBytes(object) <= MAX_CANVAS_OBJECT_BYTES && isSafe(object, 0);
};
