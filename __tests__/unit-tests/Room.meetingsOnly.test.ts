import 'jest';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import { updateRoom } from '../../src/common/authorization';
import { ManagedRoom } from '../../src/common/types';

// eslint-disable-next-line no-unused-vars
type Admission = { allowPeer: (peer: Peer) => void, parkPeer: (peer: Peer) => void };

const makeRoom = () => {
	const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });
	const admission = room as unknown as Admission;

	room.managedId = '7';
	room.locked = false;
	room.meetingsOnly = true;
	room.validateMeetingToken = jest.fn(async (token: string) => token === 'GOOD');
	const allowPeer = jest.spyOn(admission, 'allowPeer').mockImplementation(() => undefined);
	const parkPeer = jest.spyOn(admission, 'parkPeer').mockImplementation(() => undefined);

	room.resolveRoomReady();

	return { room, allowPeer, parkPeer };
};

const created: Peer[] = [];

const makePeer = (over: { meetingToken?: string, managedId?: string } = {}): Peer => {
	const peer = new Peer({ id: `p-${Math.random()}`, sessionId: 's', reconnectKey: 'k', ...over });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const closeAllPeers = (): void => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
};

const pendingLookup = (room: Room) => {
	// eslint-disable-next-line no-unused-vars
	let release: (valid: boolean) => void = () => undefined;
	let markStarted: () => void = () => undefined;
	const started = new Promise<void>((resolve) => { markStarted = resolve; });

	room.validateMeetingToken = () => new Promise<boolean>((resolve) => {
		release = resolve;
		markStarted();
	});

	return { started, release: (valid: boolean) => release(valid) };
};

const managed = (meetingsOnly: boolean): ManagedRoom => ({
	id: 7,
	name: 'r',
	meetingsOnly,
	locked: false,
	maxActiveVideos: 12,
	breakoutsEnabled: true,
	chatEnabled: true,
	raiseHandEnabled: true,
	reactionsEnabled: true,
	filesharingEnabled: true,
	localRecordingEnabled: true
} as unknown as ManagedRoom);

describe('Room.addPeer() in meetings-only mode', () => {
	afterEach(() => {
		closeAllPeers();
		jest.restoreAllMocks();
	});

	it('refuses a joiner without a token, tells them why, and closes them', async () => {
		const { room, allowPeer, parkPeer } = makeRoom();
		const peer = makePeer();

		await room.addPeer(peer);

		expect(peer.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'required' } });
		expect(allowPeer).not.toHaveBeenCalled();
		expect(parkPeer).not.toHaveBeenCalled();
		expect(peer.closed).toBe(true);
		expect((peer.notify as jest.Mock).mock.invocationCallOrder[0]).toBeDefined();
	});

	it('refuses a wrong token as invalid', async () => {
		const { room, allowPeer } = makeRoom();
		const peer = makePeer({ meetingToken: 'BAD' });

		await room.addPeer(peer);

		expect(peer.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'invalid' } });
		expect(allowPeer).not.toHaveBeenCalled();
	});

	it('admits a valid token and binds the room to that meeting', async () => {
		const { room, allowPeer } = makeRoom();
		const peer = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(peer);

		expect(allowPeer).toHaveBeenCalledWith(peer);
		expect(room.activeMeetingToken).toBe('GOOD');
		expect(peer.notify).not.toHaveBeenCalled();
	});

	it('refuses the room owner too when they have no token', async () => {
		const { room, allowPeer } = makeRoom();

		room.owners = [ { id: 1, roomId: 7, userId: 'owner' } as unknown as ManagedRoom['owners'][number] ];
		const peer = makePeer({ managedId: 'owner' });

		await room.addPeer(peer);

		expect(peer.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'required' } });
		expect(allowPeer).not.toHaveBeenCalled();
	});

	it('never gates an unmanaged room', async () => {
		const { room, allowPeer } = makeRoom();

		room.managedId = undefined;
		room.meetingsOnly = false;
		const peer = makePeer();

		await room.addPeer(peer);

		expect(allowPeer).toHaveBeenCalledWith(peer);
		expect(room.validateMeetingToken).not.toHaveBeenCalled();
	});

	it('lets a tokenless reconnect back in, since it was admitted before the mode went on', async () => {
		const { room, allowPeer } = makeRoom();
		const peer = makePeer();

		await room.addPeer(peer, true);

		expect(allowPeer).toHaveBeenCalledWith(peer);
		expect(peer.notify).not.toHaveBeenCalled();
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('binds a fresh room through a reconnect that carries a valid token', async () => {
		const { room, allowPeer } = makeRoom();
		const peer = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(peer, true);

		expect(allowPeer).toHaveBeenCalledWith(peer);
		expect(room.activeMeetingToken).toBe('GOOD');
	});

	it('refuses a reconnect whose token belongs to another meeting than the room is bound to', async () => {
		const { room, allowPeer } = makeRoom();

		room.activeMeetingToken = 'OTHER';
		const peer = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(peer, true);

		expect(peer.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'invalid' } });
		expect(allowPeer).not.toHaveBeenCalled();
	});

	it('keeps the room alive while a lookup is in flight, even if everyone else leaves meanwhile', async () => {
		const { room, allowPeer } = makeRoom();
		const lookup = pendingLookup(room);
		const present = makePeer();

		room.peers.add(present);
		const joining = makePeer({ meetingToken: 'GOOD' });
		const admission = room.addPeer(joining);

		await lookup.started;
		room.removePeer(present);
		expect(room.closed).toBe(false);
		lookup.release(true);
		await admission;

		expect(allowPeer).toHaveBeenCalledWith(joining);
		expect(room.activeMeetingToken).toBe('GOOD');
	});

	it('closes a joiner whose room closed during the lookup instead of leaving them dangling', async () => {
		const { room, allowPeer } = makeRoom();
		const lookup = pendingLookup(room);
		const joining = makePeer({ meetingToken: 'GOOD' });
		const admission = room.addPeer(joining);

		await lookup.started;
		room.close();
		lookup.release(true);
		await admission;

		expect(joining.closed).toBe(true);
		expect(allowPeer).not.toHaveBeenCalled();
	});

	it('closes the peer with no reason when the management lookup fails', async () => {
		const { room, allowPeer } = makeRoom();

		room.validateMeetingToken = async () => { throw new Error('mgmt down'); };
		const peer = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(peer);

		expect(peer.closed).toBe(true);
		expect(peer.notify).not.toHaveBeenCalled();
		expect(allowPeer).not.toHaveBeenCalled();
	});
});

describe('updateRoom() applies the flag live', () => {
	afterEach(() => {
		closeAllPeers();
		jest.restoreAllMocks();
	});

	it('switching off clears the binding so the next joiner needs no token', async () => {
		const { room, allowPeer } = makeRoom();

		await room.addPeer(makePeer({ meetingToken: 'GOOD' }));
		expect(room.activeMeetingToken).toBe('GOOD');

		updateRoom(room, managed(false));

		expect(room.meetingsOnly).toBe(false);
		expect(room.activeMeetingToken).toBeUndefined();
		const late = makePeer();

		await room.addPeer(late);
		expect(allowPeer).toHaveBeenCalledWith(late);
	});

	it('switching on leaves present peers alone and gates the next newcomer', async () => {
		const { room } = makeRoom();

		room.meetingsOnly = false;
		const present = makePeer();

		await room.addPeer(present);
		room.peers.add(present);

		updateRoom(room, managed(true));

		expect(room.meetingsOnly).toBe(true);
		expect(room.peers.has(present)).toBe(true);
		expect(present.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'meetingTokenRejected' }));
		const newcomer = makePeer();

		await room.addPeer(newcomer);
		expect(newcomer.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'required' } });
	});

	it('broadcasts the flag with the other room settings', () => {
		const { room } = makeRoom();
		const notifyPeers = jest.spyOn(room, 'notifyPeers').mockImplementation(() => undefined);

		updateRoom(room, managed(true));

		expect(notifyPeers).toHaveBeenCalledWith('roomUpdate', expect.objectContaining({ meetingsOnly: true }));
	});
});
