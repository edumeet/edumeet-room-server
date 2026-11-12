import { createFileMiddleware } from '../../../src/middlewares/fileMiddleware';
import { PeerContext } from '../../../src/Peer';
import Room from '../../../src/Room';
import { Permission } from '../../../src/common/authorization';
import { FileMessage } from '../../../src/common/types';
import { magnetInfoHashes } from '../../../src/common/textValidation';
import { MAX_FILE_HISTORY_PER_PEER } from '../../../src/common/history';

const next = jest.fn();
const HEX = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';
const victimLink = `magnet:?xt=urn:btih:${HEX}&dn=report.pdf`;

const createRoom = () => ({
	sessionId: 'session',
	fileHistory: [] as FileMessage[],
	peers: { items: [] as { id: string }[] },
	notifyPeers: jest.fn(),
} as unknown as Room);

// A peer that sends is in the room; leave() takes it out, as a reload or leaving the meeting does.
const join = (room: Room, id: string) => {
	if (!room.peers.items.some((p) => p.id === id)) (room.peers.items as unknown as { id: string }[]).push({ id });
};
const leave = (room: Room, id: string) => {
	const items = room.peers.items as unknown as { id: string }[];

	items.splice(items.findIndex((p) => p.id === id), 1);
};

const makePeer = (id: string, permissions: string[] = [ Permission.SHARE_FILE ]) => ({
	id,
	displayName: id,
	hasPermission: (p: string) => permissions.includes(p),
});

const send = (room: Room, peer: ReturnType<typeof makePeer>, method: string, magnetURI: string) => {
	join(room, peer.id);

	return createFileMiddleware({ room })({ peer, message: { method, data: { magnetURI, sessionId: 'session' } }, response: {}, handled: false } as unknown as PeerContext, next);
};

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

describe('a file whose sharer left the room', () => {
	test('can be shared again, as after a reload under a new peer id', async () => {
		const room = createRoom();

		await send(room, makePeer('before-reload'), 'sendFile', victimLink);
		leave(room, 'before-reload');
		await send(room, makePeer('after-reload'), 'sendFile', victimLink);

		expect(room.fileHistory.map((f) => f.peerId)).toEqual([ 'before-reload', 'after-reload' ]);
	});

	test('does not keep the remaining owner from clearing it', async () => {
		const room = createRoom();
		const owner = makePeer('owner');

		await send(room, makePeer('gone'), 'sendFile', victimLink);
		leave(room, 'gone');
		await send(room, owner, 'sendFile', victimLink);
		await send(room, owner, 'clearFile', victimLink);

		expect(room.fileHistory).toHaveLength(0);
		expect(room.notifyPeers).toHaveBeenCalledWith('clearFile', { magnetURI: victimLink });
	});

	test('cannot be cleared by a peer that never shared it', async () => {
		const room = createRoom();

		await send(room, makePeer('gone'), 'sendFile', victimLink);
		leave(room, 'gone');

		await expect(send(room, makePeer('stranger'), 'clearFile', victimLink)).rejects.toThrow('peer not authorized');
		expect(room.fileHistory).toHaveLength(1);
		expect(room.notifyPeers).not.toHaveBeenCalledWith('clearFile', expect.anything());
	});

	test('still protects the file of a sharer who is here', async () => {
		const room = createRoom();

		await send(room, makePeer('gone'), 'sendFile', victimLink);
		leave(room, 'gone');
		await send(room, makePeer('owner'), 'sendFile', victimLink);

		await expect(send(room, makePeer('attacker'), 'sendFile', victimLink)).rejects.toThrow('file already shared');
		await expect(send(room, makePeer('attacker'), 'clearFile', victimLink)).rejects.toThrow('peer not authorized');
		expect(room.fileHistory).toHaveLength(2);
	});
});

// The history goes to everyone who joins or reconnects. It refuses rather than forgets: a
// forgotten file could be shared again by another peer and then cleared for everyone.
describe('a full file history', () => {
	const link = (i: number) => `magnet:?xt=urn:btih:${i.toString(16).padStart(40, '0')}`;

	test('takes no more files of a peer that shared the most one peer may', async () => {
		const room = createRoom();
		const flooder = makePeer('flooder');

		await send(room, makePeer('victim'), 'sendFile', victimLink);
		for (let i = 0; i < MAX_FILE_HISTORY_PER_PEER; i++) await send(room, flooder, 'sendFile', link(i));

		await expect(send(room, flooder, 'sendFile', link(9999))).rejects.toThrow('too many files');
		expect(room.fileHistory[0].magnetURI).toBe(victimLink);
		await expect(send(room, makePeer('attacker'), 'sendFile', victimLink)).rejects.toThrow('file already shared');
		await send(room, makePeer('other'), 'sendFile', link(10000));
	});
});

test('A magnet link with characters that are not printable ASCII is refused', async () => {
	const room = createRoom();

	for (const link of [
		`magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=\u0001name`,
		`magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=zażółć`,
		`magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=two words`,
	])
		await expect(send(room, makePeer('p'), 'sendFile', link)).rejects.toThrow();

	await send(room, makePeer('p'), 'sendFile', `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=za%C5%BC%C3%B3%C5%82%C4%87`);
	expect(room.fileHistory).toHaveLength(1);
});
