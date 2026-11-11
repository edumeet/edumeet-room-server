import 'jest';
import fs from 'fs';
import path from 'path';
import { Socket } from 'socket.io';
import Room from '../../src/Room';
import MediaService from '../../src/MediaService';
import { PeerContext } from '../../src/Peer';
import { Permission } from '../../src/common/authorization';
import { FileMessage } from '../../src/common/types';
import { createPeerMiddleware } from '../../src/middlewares/peerMiddleware';
import { createLobbyPeerMiddleware } from '../../src/middlewares/lobbyPeerMiddleware';
import { createJoinMiddleware } from '../../src/middlewares/joinMiddleware';
import { createFileMiddleware } from '../../src/middlewares/fileMiddleware';
import { createBreakoutMiddleware } from '../../src/middlewares/breakoutMiddleware';
import { createDrawingMiddleware } from '../../src/middlewares/drawingMiddleware';
import { socketHandler } from '../../src/common/socketHandler';
import { isValidPeerId, MAX_MAGNET_URI_LENGTH, MAX_PICTURE_LENGTH } from '../../src/common/textValidation';
import { isValidCanvasAction, MAX_CANVAS_OBJECTS } from '../../src/common/canvasValidation';

type FabricJson = Record<string, unknown> & { clipPath: Record<string, unknown> };

const whiteboard = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/whiteboard-objects.json'), 'utf8')) as
	Record<'path' | 'text' | 'erasedPath', FabricJson>;

const next = jest.fn();
const NOT_STRINGS = [ 1, true, {}, [], null ];
const MAGNET = 'magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056&dn=notes.pdf&tr=wss%3A%2F%2Ftracker.example.org';

const run = async (middleware: ReturnType<typeof createPeerMiddleware>, peer: unknown, method: string, data: unknown) => {
	const context = { peer, message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

	await middleware(context, next);

	return context;
};

const makePeer = (id: string, permissions: Permission[] = []) => ({
	id,
	displayName: id,
	picture: undefined as unknown,
	permissions,
	hasPermission: (p: Permission) => permissions.includes(p),
});

afterEach(() => {
	jest.clearAllMocks();
});

describe('3.17 picture', () => {
	const room = () => ({ sessionId: 's', notifyPeers: jest.fn(), notifyPeersWithPermission: jest.fn() }) as unknown as Room;

	test.each(NOT_STRINGS)('changePicture with %p is refused in the room and in the lobby, and nobody is told', async (picture) => {
		for (const create of [ createPeerMiddleware, createLobbyPeerMiddleware ]) {
			const r = room();
			const peer = makePeer('a');

			await expect(run(create({ room: r }), peer, 'changePicture', { picture })).rejects.toThrow('invalid picture');
			expect(peer.picture).toBeUndefined();
			expect(r.notifyPeers).not.toHaveBeenCalled();
			expect(r.notifyPeersWithPermission).not.toHaveBeenCalled();
		}
	});

	test('a picture over the length limit is refused', async () => {
		await expect(run(createPeerMiddleware({ room: room() }), makePeer('a'), 'changePicture', { picture: 'x'.repeat(MAX_PICTURE_LENGTH + 1) }))
			.rejects.toThrow('invalid picture');
	});

	test('a URL and the empty picture the client sends without one are accepted', async () => {
		for (const picture of [ 'https://idp.example.org/me.png', '' ]) {
			const r = room();
			const peer = makePeer('a');

			await run(createPeerMiddleware({ room: r }), peer, 'changePicture', { picture });
			expect(peer.picture).toBe(picture);
			expect(r.notifyPeers).toHaveBeenCalledWith('changePicture', { peerId: 'a', picture }, peer);
		}
	});

	test('a join with a picture that is not a string joins without one', async () => {
		const r = {
			sessionId: 's',
			lobbyPeers: { items: [] },
			chatHistory: [],
			fileHistory: [],
			countdownTimer: {},
			drawing: {},
			locked: false,
			getPeers: () => [],
			getBreakoutRooms: () => [],
			joinPeer: jest.fn(),
		} as unknown as Room;
		const peer = { ...makePeer('a'), closed: false };

		await run(createJoinMiddleware({ room: r }), peer, 'join', { displayName: 'A', picture: { evil: true } });
		expect(peer.picture).toBeUndefined();
		expect(r.joinPeer).toHaveBeenCalled();
	});
});

describe('3.22 shared file link', () => {
	const room = () => ({ sessionId: 's', fileHistory: [] as FileMessage[], notifyPeers: jest.fn() });

	test.each([ ...NOT_STRINGS, undefined, '', 'https://example.org/file', 'magnet:?dn=no-hash', `${MAGNET}&x=${'a'.repeat(MAX_MAGNET_URI_LENGTH)}` ])(
		'sendFile with %p is refused, not stored and not announced',
		async (magnetURI) => {
			const r = room();

			await expect(run(createFileMiddleware({ room: r as unknown as Room }), makePeer('a', [ Permission.SHARE_FILE ]), 'sendFile', { magnetURI }))
				.rejects.toThrow('invalid magnetURI');
			expect(r.fileHistory).toEqual([]);
			expect(r.notifyPeers).not.toHaveBeenCalled();
		}
	);

	test('a magnet link is shared', async () => {
		const r = room();

		await run(createFileMiddleware({ room: r as unknown as Room }), makePeer('a', [ Permission.SHARE_FILE ]), 'sendFile', { magnetURI: MAGNET });
		expect(r.fileHistory.map((f) => f.magnetURI)).toEqual([ MAGNET ]);
		expect(r.notifyPeers).toHaveBeenCalledTimes(1);
	});
});

describe('3.24 removing a shared file', () => {
	const shared = () => ({
		sessionId: 's',
		fileHistory: [ { magnetURI: MAGNET, peerId: 'a', timestamp: 1 } ] as FileMessage[],
		notifyPeers: jest.fn(),
	});

	test('another participant cannot remove it for everyone', async () => {
		const r = shared();

		await expect(run(createFileMiddleware({ room: r as unknown as Room }), makePeer('b'), 'clearFile', { magnetURI: MAGNET }))
			.rejects.toThrow('peer not authorized');
		expect(r.fileHistory).toHaveLength(1);
		expect(r.notifyPeers).not.toHaveBeenCalled();
	});

	test('its owner can', async () => {
		const r = shared();

		await run(createFileMiddleware({ room: r as unknown as Room }), makePeer('a'), 'clearFile', { magnetURI: MAGNET });
		expect(r.fileHistory).toEqual([]);
		expect(r.notifyPeers).toHaveBeenCalledWith('clearFile', { magnetURI: MAGNET });
	});

	test('a participant with MODERATE_FILES can', async () => {
		const r = shared();

		await run(createFileMiddleware({ room: r as unknown as Room }), makePeer('m', [ Permission.MODERATE_FILES ]), 'clearFile', { magnetURI: MAGNET });
		expect(r.fileHistory).toEqual([]);
		expect(r.notifyPeers).toHaveBeenCalledTimes(1);
	});
});

describe('3.20 breakout room name', () => {
	test.each([ {}, [ 'x' ], 7, '   ', 'x'.repeat(129) ])('createBreakoutRoom with %p is refused and nothing is announced', async (name) => {
		const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });
		const notify = jest.spyOn(room, 'notifyPeers');

		await expect(run(createBreakoutMiddleware({ room }), makePeer('m', [ Permission.CREATE_ROOM ]), 'createBreakoutRoom', { name }))
			.rejects.toThrow('invalid name');
		expect(room.breakoutRooms.size).toBe(0);
		expect(notify).not.toHaveBeenCalled();
	});

	test('a name is accepted', async () => {
		const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

		await run(createBreakoutMiddleware({ room }), makePeer('m', [ Permission.CREATE_ROOM ]), 'createBreakoutRoom', { name: 'Group 1' });
		expect(room.breakoutRooms.size).toBe(1);
	});
});

describe('3.09 peer id', () => {
	test.each([ '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'a b', 'x'.repeat(65), [ 'a' ] ])('%p is not a peer id', (id) => {
		expect(isValidPeerId(id)).toBe(false);
	});

	test('the client\'s UUIDs are', () => {
		expect(isValidPeerId('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(true);
	});

	test('a connection with the peer id __proto__ is closed and never reaches the server manager', () => {
		const handleConnection = jest.fn(async () => undefined);
		const disconnect = jest.fn();
		const socket = {
			id: 'sock',
			handshake: { query: { roomId: 'r', peerId: '__proto__', reconnectKey: 'k' }, headers: { host: 'rooms.example.org' }, auth: {} },
			disconnect,
			on: jest.fn(),
			once: jest.fn(),
		} as unknown as Socket;

		global.serverManager = { handleConnection } as unknown as typeof global.serverManager;

		socketHandler(socket);
		expect(disconnect).toHaveBeenCalledWith(true);
		expect(handleConnection).not.toHaveBeenCalled();
	});
});

describe('3.12 whiteboard objects', () => {
	const makeRoom = () => ({
		sessionId: 's',
		notifyPeers: jest.fn(),
		drawing: { isEnabled: true, bgColor: 'white', canvasState: [] as { objectId: unknown }[] },
	});
	const update = (room: ReturnType<typeof makeRoom>, data: unknown) =>
		run(createDrawingMiddleware({ room: room as unknown as Room }), makePeer('a'), 'updateCanvasState', data);

	test.each(Object.entries(whiteboard))('the client\'s %s is stored and passed on', async (_name, object) => {
		const room = makeRoom();

		await update(room, { status: 'added', object });
		expect(room.drawing.canvasState).toHaveLength(1);
		expect(room.notifyPeers).toHaveBeenCalledTimes(1);
	});

	const bad: Record<string, unknown> = {
		'an image': { type: 'Image', id: 1, src: 'https://evil.example/pixel.png' },
		'a path with an image clip': { ...whiteboard.path, clipPath: { type: 'Image', src: 'https://evil.example/p.png' } },
		'a clipping group holding an image': { ...whiteboard.erasedPath, clipPath: { ...whiteboard.erasedPath.clipPath, objects: [ { type: 'Image' } ] } },
		'a pattern fill': { ...whiteboard.path, fill: { type: 'pattern', source: 'https://evil.example/tile.png' } },
		'a src hidden deeper': { ...whiteboard.text, styles: [ { start: 0, end: 1, style: { src: 'https://evil.example/x.png' } } ] },
		'an object without id': { ...whiteboard.path, id: undefined },
		'a key named like a fabric method': { ...whiteboard.path, render: 1 },
		'a private fabric field': { ...whiteboard.path, _render: 'x' },
		'a method key on text': { ...whiteboard.text, toObject: null },
		'a method key in a clip group': { ...whiteboard.erasedPath, clipPath: { ...whiteboard.erasedPath.clipPath, drawObject: 0 } },
		'a method key on an eraser stroke': { ...whiteboard.erasedPath, clipPath: { ...whiteboard.erasedPath.clipPath, objects: [ { ...whiteboard.path, setCoords: 1 } ] } },
		'a number where fabric expects a boolean': { ...whiteboard.path, visible: 1 },
		'a shadow object': { ...whiteboard.path, shadow: { color: 'red', blur: 1e9 } },
		'a path command that is not a letter': { ...whiteboard.path, path: [ [ 'toString', 1 ] ] },
		'an unknown layout strategy': { ...whiteboard.erasedPath, clipPath: { ...whiteboard.erasedPath.clipPath, layoutManager: { type: 'layoutManager', strategy: 'render' } } },
		'an unknown text style key': { ...whiteboard.text, styles: [ { start: 0, end: 1, style: { render: 1 } } ] },
		'an oversized object': { ...whiteboard.path, path: Array.from({ length: 50000 }, () => [ 'L', 123.4567, 234.5678 ]) },
	};

	test.each(Object.keys(bad))('%s is refused, not stored and not passed on', async (name) => {
		const room = makeRoom();

		expect(isValidCanvasAction({ status: 'added', object: bad[name] })).toBe(false);
		await expect(update(room, { status: 'added', object: bad[name] })).rejects.toThrow('invalid canvas object');
		expect(room.drawing.canvasState).toEqual([]);
		expect(room.notifyPeers).not.toHaveBeenCalled();
	});

	test('an unknown status is refused', async () => {
		await expect(update(makeRoom(), { status: 'replace', object: whiteboard.path })).rejects.toThrow('invalid canvas object');
	});

	test('the canvas holds a bounded number of objects', async () => {
		const room = makeRoom();

		room.drawing.canvasState = Array.from({ length: MAX_CANVAS_OBJECTS }, (_, i) => ({ objectId: i, object: { id: i }, status: 'added' }));

		await expect(update(room, { status: 'added', object: whiteboard.path })).rejects.toThrow('canvas full');
		expect(room.drawing.canvasState).toHaveLength(MAX_CANVAS_OBJECTS);
		expect(room.notifyPeers).not.toHaveBeenCalled();
	});
});
