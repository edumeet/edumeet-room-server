import 'jest';
import { isValidCanvasAction } from '../../../src/common/canvasValidation';

// socket.io decodes with JSON.parse, which makes "__proto__" an ordinary key; fabric's set()
// would then replace the object's prototype in every browser that loads the whiteboard.
const action = (object: string) => JSON.parse(`{ "status": "added", "object": ${object} }`);

describe('whiteboard objects', () => {
	test('with a prototype key at any depth are refused', () => {
		for (const key of [ '__proto__', 'constructor', 'prototype' ]) {
			expect(isValidCanvasAction(action(`{ "type": "Path", "id": 1, "${key}": { "x": 1 } }`))).toBe(false);
			expect(isValidCanvasAction(action(`{ "type": "IText", "id": 2, "styles": { "0": { "0": { "${key}": {} } } } }`))).toBe(false);
		}
	});

	test('as the client makes them still pass', () => {
		expect(isValidCanvasAction(action('{ "type": "Path", "id": 1, "path": [ [ "M", 0, 0 ], [ "L", 1, 1 ] ], "stroke": "black" }'))).toBe(true);
	});
});
