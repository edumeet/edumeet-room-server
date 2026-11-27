import 'jest';
import Room, { MEETING_ACTIVITY_INTERVAL } from '../../src/Room';
import { Peer } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import { updateRoom } from '../../src/common/authorization';
import { ManagedRoom } from '../../src/common/types';
import { MeetingTokenLookup } from '../../src/common/meetingToken';

// eslint-disable-next-line no-unused-vars
type Admission = { allowPeer: (peer: Peer) => void, parkPeer: (peer: Peer) => void };

const makeRoom = () => {
	const room = new Room({ id: 'r', tenantId: 1, mediaService: {} as unknown as MediaService });
	const admission = room as unknown as Admission;

	room.managedId = '7';
	room.locked = false;
	room.meetingsOnly = true;
	room.validateMeetingToken = jest.fn(async (token: string) => ({ found: token === 'GOOD' }));
	const allowPeer = jest.spyOn(admission, 'allowPeer').mockImplementation(() => undefined);
	const parkPeer = jest.spyOn(admission, 'parkPeer').mockImplementation(() => undefined);

	room.resolveRoomReady();

	return { room, allowPeer, parkPeer };
};

const created: Peer[] = [];

const makePeer = (over: { meetingToken?: string, managedId?: string, botVerified?: boolean } = {}): Peer => {
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

	room.validateMeetingToken = () => new Promise<MeetingTokenLookup>((resolve) => {
		release = (valid: boolean) => resolve({ found: valid });
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

	it('refuses a token before the meeting opens, with its times, and closes the peer', async () => {
		const { room, allowPeer } = makeRoom();
		const peer = makePeer({ meetingToken: 'GOOD' });

		room.validateMeetingToken = async () => ({ found: true, window: { state: 'early' as const, startsAt: 1000, endsAt: 2000 } });
		await room.addPeer(peer);

		expect(peer.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'early', startsAt: 1000, endsAt: 2000 } });
		expect(allowPeer).not.toHaveBeenCalled();
		expect(peer.closed).toBe(true);
		expect(room.activeMeetingToken).toBeUndefined();
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

	it('lets a reconnect with a token back in after the meeting is over, since it was in the room', async () => {
		const { room, allowPeer } = makeRoom();
		const peer = makePeer({ meetingToken: 'GOOD' });

		room.validateMeetingToken = async () => ({ found: true, window: { state: 'over', startsAt: 1000, endsAt: 2000 } });
		await room.addPeer(peer, true);

		expect(allowPeer).toHaveBeenCalledWith(peer);
		expect(peer.notify).not.toHaveBeenCalled();
		// Let back in, but the room is not bound to a meeting outside its time.
		expect(room.activeMeetingToken).toBeUndefined();
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

	it('switching off lets the next joiner in without a token, and back on keeps the meeting of the room', async () => {
		const { room, allowPeer } = makeRoom();
		const present = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(present);
		room.peers.add(present);
		expect(room.activeMeetingToken).toBe('GOOD');

		updateRoom(room, managed(false));

		expect(room.meetingsOnly).toBe(false);
		const late = makePeer();

		await room.addPeer(late);
		expect(allowPeer).toHaveBeenCalledWith(late);

		updateRoom(room, managed(true));
		const validate = jest.fn(async () => ({ found: true }));

		room.validateMeetingToken = validate;
		const other = makePeer({ meetingToken: 'OTHER' });
		const sameMeeting = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(other);
		await room.addPeer(sameMeeting);
		expect(other.notify).toHaveBeenCalledWith({ method: 'meetingTokenRejected', data: { reason: 'invalid' } });
		expect(allowPeer).toHaveBeenCalledWith(sameMeeting);
		expect(validate).not.toHaveBeenCalled();
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

describe('meeting activity reported to management', () => {
	const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
	const withReports = (report: () => Promise<unknown> | undefined = async () => undefined) => {
		const made = makeRoom();
		const reportMeetingActivity = jest.fn(report);

		made.room.reportMeetingActivity = reportMeetingActivity;

		return { ...made, reportMeetingActivity };
	};

	beforeEach(() => {
		jest.useFakeTimers({ doNotFake: [ 'setImmediate' ] });
	});

	afterEach(() => {
		jest.useRealTimers();
		closeAllPeers();
		jest.restoreAllMocks();
	});

	it('stops when the meeting is deleted, and starts again for the meeting that binds the room next', async () => {
		const { room, reportMeetingActivity } = withReports();
		const valid = new Set([ 'GOOD' ]);

		room.validateMeetingToken = jest.fn(async (token: string) => ({ found: valid.has(token) }));

		const staying = makePeer({ meetingToken: 'GOOD' });

		await room.addPeer(staying);
		expect(reportMeetingActivity).toHaveBeenCalledTimes(1);

		valid.delete('GOOD');
		valid.add('NEXT');
		expect(room.releaseMeeting('GOOD')).toBe(true);
		expect(staying.closed).toBe(false);

		jest.advanceTimersByTime(MEETING_ACTIVITY_INTERVAL);
		expect(reportMeetingActivity).toHaveBeenCalledTimes(1);

		await room.addPeer(makePeer({ meetingToken: 'NEXT' }));
		expect(reportMeetingActivity).toHaveBeenCalledTimes(2);
		expect(reportMeetingActivity).toHaveBeenLastCalledWith('NEXT');
	});

	it('reports when the room binds, every five minutes while in use, and once more when it empties', async () => {
		const { room, reportMeetingActivity } = withReports();

		await room.addPeer(makePeer({ meetingToken: 'GOOD' }));
		expect(reportMeetingActivity).toHaveBeenCalledTimes(1);
		expect(reportMeetingActivity).toHaveBeenLastCalledWith('GOOD');

		await room.addPeer(makePeer({ meetingToken: 'GOOD' }));
		expect(reportMeetingActivity).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(MEETING_ACTIVITY_INTERVAL);
		expect(reportMeetingActivity).toHaveBeenCalledTimes(2);
		jest.advanceTimersByTime(MEETING_ACTIVITY_INTERVAL);
		expect(reportMeetingActivity).toHaveBeenCalledTimes(3);

		room.close();
		expect(reportMeetingActivity).toHaveBeenCalledTimes(4);
		expect(reportMeetingActivity).toHaveBeenLastCalledWith('GOOD');

		jest.advanceTimersByTime(3 * MEETING_ACTIVITY_INTERVAL);
		expect(reportMeetingActivity).toHaveBeenCalledTimes(4);
	});

	it('reports nothing for a refused token, a room that is not meetings only, or a verified bot', async () => {
		const { room, reportMeetingActivity } = withReports();

		await room.addPeer(makePeer({ meetingToken: 'BAD' }));
		await room.addPeer(makePeer({ meetingToken: 'GOOD', botVerified: true }));
		room.meetingsOnly = false;
		await room.addPeer(makePeer());
		jest.advanceTimersByTime(2 * MEETING_ACTIVITY_INTERVAL);
		room.close();

		expect(reportMeetingActivity).not.toHaveBeenCalled();
	});

	it('keeps reporting while the mode is switched off and on, as the room stays with its meeting', async () => {
		const { room, reportMeetingActivity } = withReports();

		await room.addPeer(makePeer({ meetingToken: 'GOOD' }));
		updateRoom(room, managed(false));
		jest.advanceTimersByTime(MEETING_ACTIVITY_INTERVAL);
		updateRoom(room, managed(true));
		jest.advanceTimersByTime(MEETING_ACTIVITY_INTERVAL);
		expect(reportMeetingActivity).toHaveBeenCalledTimes(3);

		room.close();
		expect(reportMeetingActivity).toHaveBeenCalledTimes(4);
		expect(reportMeetingActivity).toHaveBeenLastCalledWith('GOOD');
	});

	it('keeps admitting when management fails the report or is closed', async () => {
		for (const report of [ async () => { throw new Error('mgmt down'); }, () => undefined ]) {
			const { room, allowPeer, reportMeetingActivity } = withReports(report);
			const peer = makePeer({ meetingToken: 'GOOD' });

			await room.addPeer(peer);
			jest.advanceTimersByTime(MEETING_ACTIVITY_INTERVAL);
			room.close();
			await flush();

			expect(allowPeer).toHaveBeenCalledWith(peer);
			expect(reportMeetingActivity).toHaveBeenCalledTimes(3);
		}
	});
});
