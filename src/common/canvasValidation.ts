import { CanvasObject } from './types';

// What the whiteboard sends: freehand paths and text, and the clipping group the eraser adds.
// Every client passes these objects to fabric, which loads images, patterns and filters itself,
// so anything else could make all participants' browsers fetch a URL of the sender's choice.
const OBJECT_TYPES = new Set([ 'Path', 'IText' ]);
const STATUSES = new Set([ 'added', 'modified', 'removed', 'editing', 'lock' ]);
const MAX_DEPTH = 12;

// An erased object carries every eraser stroke, so one object may be as large as a socket.io message.
export const MAX_CANVAS_OBJECT_BYTES = 1_000_000;
export const MAX_CANVAS_OBJECTS = 10_000;
// A room sends its whole whiteboard to everyone who joins or reconnects. Erasing makes it grow,
// as every object the eraser touches keeps the part of each stroke near it: twenty strokes over
// a block of handwriting of 0.3 MB make it 1.1 MB.
export const MAX_CANVAS_BYTES = 5_000_000;

export interface CanvasAction {
	object: Record<string, unknown> & { id: string | number };
	status: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// fabric copies every own key of a serialized object onto the object it makes, so a key
// named like one of its methods (render, toObject, ...) would replace that method with data
// in every client, __proto__ would replace its prototype, and src or filters would make it
// load a URL. Only the keys the client's own toObject() writes for each type are taken,
// each with the type of value fabric gives it.
// eslint-disable-next-line no-unused-vars
type Check = (value: unknown, depth: number) => boolean;

const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const str: Check = (v) => typeof v === 'string' && v.length <= 1000;
const bool: Check = (v) => typeof v === 'boolean';
const nil = (v: unknown) => v === null || v === undefined;
const or = (...checks: Check[]): Check => (v, d) => checks.some((c) => c(v, d));
const strOrNull: Check = or(str, nil);
const numOrStr: Check = or(num, str);
const numArrayOrNull: Check = (v) => nil(v) || (Array.isArray(v) && v.length <= 1000 && v.every((n) => num(n, 0)));
const pathData: Check = (v) => Array.isArray(v) && v.every((cmd) =>
	Array.isArray(cmd) && typeof cmd[0] === 'string' && cmd[0].length === 1 && cmd.slice(1).every((n) => num(n, 0)));

const TEXT_STYLE_KEYS = new Set([
	'fill', 'stroke', 'strokeWidth', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'underline',
	'overline', 'linethrough', 'deltaY', 'textBackgroundColor', 'textDecorationThickness',
]);
const textStyles: Check = (v) => Array.isArray(v) && v.every((range) =>
	isPlainObject(range) &&
	Object.keys(range).every((k) => k === 'start' || k === 'end' || k === 'style') &&
	num(range.start, 0) && num(range.end, 0) &&
	isPlainObject(range.style) &&
	Object.entries(range.style).every(([ k, item ]) => TEXT_STYLE_KEYS.has(k) && (num(item, 0) || str(item, 0) || bool(item, 0))));

const layoutManager: Check = (v) => isPlainObject(v) &&
	Object.keys(v).every((k) => k === 'type' || k === 'strategy') &&
	v.type === 'layoutManager' && (v.strategy === 'fixed' || v.strategy === 'fit-content');

// eslint-disable-next-line prefer-const
let clipping: Check;
// eslint-disable-next-line prefer-const
let path: Check;

const COMMON_KEYS: Record<string, Check> = {
	type: str,
	version: str,
	id: numOrStr,
	originX: numOrStr,
	originY: numOrStr,
	left: num,
	top: num,
	width: num,
	height: num,
	fill: strOrNull,
	stroke: strOrNull,
	strokeWidth: num,
	strokeDashArray: numArrayOrNull,
	strokeLineCap: str,
	strokeDashOffset: num,
	strokeLineJoin: str,
	strokeUniform: bool,
	strokeMiterLimit: num,
	scaleX: num,
	scaleY: num,
	angle: num,
	flipX: bool,
	flipY: bool,
	skewX: num,
	skewY: num,
	opacity: num,
	shadow: nil,
	visible: bool,
	backgroundColor: strOrNull,
	fillRule: str,
	paintFirst: str,
	globalCompositeOperation: str,
	inverted: bool,
	absolutePositioned: bool,
	clipPath: (v, d) => nil(v) || clipping(v, d),
};

const KEYS_BY_TYPE: Record<string, Record<string, Check>> = {
	Path: { ...COMMON_KEYS, path: pathData },
	IText: {
		...COMMON_KEYS,
		fontSize: num,
		fontWeight: numOrStr,
		fontFamily: str,
		fontStyle: str,
		lineHeight: num,
		text: (v) => typeof v === 'string',
		charSpacing: num,
		textAlign: str,
		styles: textStyles,
		pathStartOffset: num,
		pathSide: str,
		pathAlign: str,
		underline: bool,
		overline: bool,
		linethrough: bool,
		textBackgroundColor: strOrNull,
		direction: str,
		textDecorationThickness: num,
	},
	clipping: {
		...COMMON_KEYS,
		subTargetCheck: bool,
		interactive: bool,
		layoutManager,
		objects: (v, d) => Array.isArray(v) && v.every((o) => path(o, d)),
	},
};

const ofType = (type: string): Check => (value, depth) => {
	if (depth > MAX_DEPTH || !isPlainObject(value) || value.type !== type) return false;

	const keys = KEYS_BY_TYPE[type];

	return Object.entries(value).every(([ key, item ]) =>
		Object.prototype.hasOwnProperty.call(keys, key) && keys[key](item, depth + 1));
};

clipping = ofType('clipping');
path = ofType('Path');

const isValidObject = (object: Record<string, unknown>): boolean =>
	ofType(object.type as string)(object, 0);

export const canvasObjectBytes = (object: object): number => JSON.stringify(object).length;

// The size of each stored entry, measured when it was accepted.
export const objectBytes = new WeakMap<CanvasObject, number>();

export const canvasStateBytes = (canvasState: CanvasObject[]): number =>
	canvasState.reduce((total, entry) => total + (objectBytes.get(entry) ?? canvasObjectBytes(entry.object)), 0);

export const isValidCanvasAction = (action: unknown): action is CanvasAction => {
	if (!isPlainObject(action) || !STATUSES.has(action.status as string)) return false;

	const { object } = action;

	if (!isPlainObject(object) || !OBJECT_TYPES.has(object.type as string)) return false;
	if (typeof object.id !== 'number' && typeof object.id !== 'string') return false;

	return canvasObjectBytes(object) <= MAX_CANVAS_OBJECT_BYTES && isValidObject(object);
};
