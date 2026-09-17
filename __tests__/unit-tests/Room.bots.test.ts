import 'jest';
import Room from '../../src/Room';
import { Peer, PeerContext } from '../../src/Peer';
import MediaService from '../../src/MediaService';

const created: Peer[] = [];

const makePeer = (headless = false): Peer => {
	const peer = new Peer({ id: `p-${created.length}`, sessionId: 's', reconnectKey: 'k', headless });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const makeRoom = (): Room => new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });

const request = async (peer: Peer, method: string, data: Record<string, unknown> = {}): Promise<PeerContext> => {
	const context = { peer, message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

	await peer.pipeline.execute(context);

	return context;
};

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
});

describe('a headless peer in the room', () => {
	test('is announced with the headless flag and listed with the others', () => {
		const room = makeRoom();
		const human = makePeer();
		const bot = makePeer(true);

		room.joinPeer(human);
		room.joinPeer(bot);

		expect(human.notify).toHaveBeenCalledWith({ method: 'newPeer', data: expect.objectContaining({ id: bot.id, headless: true }) });
		expect(room.getPeers().map((p) => p.id)).toEqual([ human.id, bot.id ]);
		expect(room.participants.map((p) => p.id)).toEqual([ human.id ]);
		expect(human.peerInfo.headless).toBe(false);
	});

	test('cannot chat, raise a hand, vote to end the meeting or moderate', async () => {
		const room = makeRoom();
		const bot = makePeer(true);

		room.joinPeer(bot);

		for (const method of [ 'chatMessage', 'raisedHand', 'escapeMeeting', 'moderator:muteAll', 'lockRoom', 'sendFile', 'updateCanvasState', 'changeDisplayName' ]) {
			const context = await request(bot, method, { raisedHand: true, escapeMeeting: true });

			expect(context.handled).toBe(false);
		}
	});

	test('still reaches the media and MLS handlers', async () => {
		const room = makeRoom();
		const bot = makePeer(true);

		room.joinPeer(bot);

		await expect(request(bot, 'resumeConsumer', { consumerId: 'missing' })).rejects.toThrow();
		await expect(request(bot, 'mlsKeyPackage', {})).rejects.toThrow();
	});

	test('does not keep the room open once the last participant has left', () => {
		const room = makeRoom();
		const closed = jest.fn();
		const human = makePeer();
		const bot = makePeer(true);

		room.once('close', closed);
		room.joinPeer(bot);
		room.joinPeer(human);

		expect(room.empty).toBe(false);

		room.removePeer(human);

		expect(closed).toHaveBeenCalledTimes(1);
		expect(room.closed).toBe(true);
	});

	test('keeps the room open while a participant is still there', () => {
		const room = makeRoom();
		const human = makePeer();
		const bot = makePeer(true);

		room.joinPeer(human);
		room.joinPeer(bot);
		room.removePeer(bot);

		expect(room.closed).toBe(false);
		expect(human.notify).toHaveBeenCalledWith({ method: 'peerClosed', data: { peerId: bot.id } });
	});
});

describe('a headless peer coming back from a long disconnect', () => {
	// eslint-disable-next-line no-unused-vars
	type Admission = { allowPeer: (p: Peer) => void, parkPeer: (p: Peer) => void };

	const lockedRoom = () => {
		const room = makeRoom();
		const admission = room as unknown as Admission;

		room.locked = true;
		const allowPeer = jest.spyOn(admission, 'allowPeer').mockImplementation(() => undefined);
		const parkPeer = jest.spyOn(admission, 'parkPeer').mockImplementation(() => undefined);

		room.resolveRoomReady();

		return { room, allowPeer, parkPeer };
	};

	test('is parked by a locked room when it arrives for the first time', async () => {
		const { room, allowPeer, parkPeer } = lockedRoom();

		await room.addPeer(makePeer(true));

		expect(parkPeer).toHaveBeenCalledTimes(1);
		expect(allowPeer).not.toHaveBeenCalled();
	});

	test('is admitted again by a locked room on a reconnect', async () => {
		const { room, allowPeer, parkPeer } = lockedRoom();

		await room.addPeer(makePeer(true), true);

		expect(allowPeer).toHaveBeenCalledTimes(1);
		expect(parkPeer).not.toHaveBeenCalled();
	});

	test('does not let a participant through the lock on a reconnect', async () => {
		const { room, allowPeer, parkPeer } = lockedRoom();

		await room.addPeer(makePeer(), true);

		expect(parkPeer).toHaveBeenCalledTimes(1);
		expect(allowPeer).not.toHaveBeenCalled();
	});
});
