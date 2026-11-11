import { createFileMiddleware } from '../../../src/middlewares/fileMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import { Permission } from '../../../src/common/authorization';
import { FileMessage } from '../../../src/common/types';
import { magnetInfoHashes } from '../../../src/common/textValidation';

const next = jest.fn();
const HEX = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';
const victimLink = `magnet:?xt=urn:btih:${HEX}&dn=report.pdf`;

const createRoom = () => ({
	sessionId: 'session',
	fileHistory: [] as FileMessage[],
	notifyPeers: jest.fn(),
} as unknown as Room);

const makePeer = (id: string, permissions: string[] = [ Permission.SHARE_FILE ]) => ({
	id,
	displayName: id,
	hasPermission: (p: string) => permissions.includes(p),
});

const send = (room: Room, peer: ReturnType<typeof makePeer>, method: string, magnetURI: string) =>
	createFileMiddleware({ room })({ peer, message: { method, data: { magnetURI, sessionId: 'session' } }, response: {}, handled: false } as unknown as PeerContext, next);

afterEach(() => jest.clearAllMocks());

test('the info-hash of a link is the same in hex and base32', () => {
	expect(magnetInfoHashes(victimLink)).toEqual([ HEX ]);
	expect(magnetInfoHashes('magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK')).toEqual([ HEX ]);
});

describe('another peer\'s file', () => {
	test.each([
		victimLink,
		`magnet:?xt=urn:btih:${HEX.toUpperCase()}`,
		'magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK&dn=other',
	])('cannot be shared again by someone else as %s', async (link) => {
		const room = createRoom();

		await send(room, makePeer('victim'), 'sendFile', victimLink);
		await expect(send(room, makePeer('attacker'), 'sendFile', link)).rejects.toThrow('file already shared');
		expect(room.fileHistory).toHaveLength(1);
	});

	test('cannot be cleared by a peer without MODERATE_FILES, whatever it shared before', async () => {
		const room = createRoom();
		const attacker = makePeer('attacker');

		await send(room, makePeer('victim'), 'sendFile', victimLink);
		await send(room, attacker, 'sendFile', 'magnet:?xt=urn:btih:0000000000000000000000000000000000000000');
		(room.notifyPeers as jest.Mock).mockClear();

		await expect(send(room, attacker, 'clearFile', victimLink)).rejects.toThrow('peer not authorized');
		// An entry slipped in under the attacker's id (from before this fix) does not help either.
		room.fileHistory.push({ ...room.fileHistory[0], peerId: 'attacker' });
		await expect(send(room, attacker, 'clearFile', victimLink)).rejects.toThrow('peer not authorized');

		expect(room.notifyPeers).not.toHaveBeenCalledWith('clearFile', expect.anything());
	});

	test('can be cleared by its owner and by a moderator', async () => {
		const room = createRoom();

		await send(room, makePeer('victim'), 'sendFile', victimLink);
		await send(room, makePeer('victim'), 'clearFile', victimLink);
		expect(room.fileHistory).toHaveLength(0);

		await send(room, makePeer('victim'), 'sendFile', victimLink);
		await send(room, makePeer('mod', [ Permission.MODERATE_FILES ]), 'clearFile', victimLink);
		expect(room.fileHistory).toHaveLength(0);
		expect(room.notifyPeers).toHaveBeenCalledWith('clearFile', { magnetURI: victimLink });
	});

	test('the owner may share its own file again', async () => {
		const room = createRoom();

		await send(room, makePeer('victim'), 'sendFile', victimLink);
		await send(room, makePeer('victim'), 'sendFile', victimLink);
		expect(room.fileHistory).toHaveLength(2);
	});
});

test('clearFile tells the clients each link as it was shared', async () => {
	const room = createRoom();
	const base32 = 'magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK';

	await send(room, makePeer('victim'), 'sendFile', victimLink);
	await send(room, makePeer('mod', [ Permission.MODERATE_FILES ]), 'clearFile', base32);

	expect(room.fileHistory).toHaveLength(0);
	expect(room.notifyPeers).toHaveBeenCalledWith('clearFile', { magnetURI: victimLink });
	expect(room.notifyPeers).not.toHaveBeenCalledWith('clearFile', { magnetURI: base32 });
});
