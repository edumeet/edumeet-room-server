export type MeetingTokenRejection = 'required' | 'invalid' | 'early' | 'over';

export interface MeetingTokenRefusal {
	reason: MeetingTokenRejection;
	startsAt?: number;
	endsAt?: number;
}

export interface MeetingTokenWindow {
	state: 'open' | 'early' | 'over';
	startsAt: number;
	endsAt: number;
}

// A management server older than the window sends none: the meeting then counts as open.
export interface MeetingTokenLookup {
	found: boolean;
	window?: MeetingTokenWindow;
}

export interface MeetingTokenGate {
	meetingsOnly: boolean;
	activeMeetingToken?: string;
	// eslint-disable-next-line no-unused-vars
	validateMeetingToken?: (token: string) => Promise<MeetingTokenLookup>;
}

const WINDOW_STATES = [ 'open', 'early', 'over' ];

export const asTokenWindow = (raw: unknown): MeetingTokenWindow | undefined => {
	if (!raw || typeof raw !== 'object') return undefined;

	const { state, startsAt, endsAt } = raw as Record<string, unknown>;

	if (typeof state !== 'string' || !WINDOW_STATES.includes(state)) return undefined;
	if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return undefined;

	return { state: state as MeetingTokenWindow['state'], startsAt: startsAt as number, endsAt: endsAt as number };
};

export const normalizeMeetingToken = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string') return undefined;

	const token = raw.trim().toUpperCase();

	return token.length > 0 ? token : undefined;
};

// A room bound to a meeting compares in memory and never looks at the time again: a meeting
// that runs over keeps admitting its latecomers.
const compareWithActive = (room: MeetingTokenGate, token: string): MeetingTokenRefusal | undefined =>
	(room.activeMeetingToken === token ? undefined : { reason: 'invalid' });

// The meeting a room is bound to was deleted or cancelled: the room lets go of its token.
// Whoever is in the room stays. The next token is looked up again, so the old link admits
// nobody any more and the link of a meeting made in its place works. Returns whether the
// room was bound to that token.
export const releaseMeetingToken = (room: MeetingTokenGate, token: unknown): boolean => {
	const released = normalizeMeetingToken(token);

	if (!released || room.activeMeetingToken !== released) return false;

	room.activeMeetingToken = undefined;

	return true;
};

// A reconnecting peer was in this room before: it is let back in whatever the time of its
// meeting, so nobody is sent out of a meeting that is still going on.
export const admitMeetingToken = async (room: MeetingTokenGate, token?: string, reconnect = false): Promise<MeetingTokenRefusal | undefined> => {
	if (!room.meetingsOnly) return;
	if (!token) return { reason: 'required' };
	if (room.activeMeetingToken) return compareWithActive(room, token);

	// A closed management service answers nothing: refused as invalid, not thrown.
	const lookup = (room.validateMeetingToken ? await room.validateMeetingToken(token) : undefined) ?? { found: false };

	if (!room.meetingsOnly) return;
	if (room.activeMeetingToken) return compareWithActive(room, token);
	if (!lookup.found) return { reason: 'invalid' };

	const window = lookup.window;

	if (window && window.state !== 'open') {
		// Let back in, but the room is not bound: the token is the client's choice, and a room
		// bound to a meeting outside its time refuses the invitees of the meeting that is on.
		if (reconnect) return;

		return { reason: window.state, startsAt: window.startsAt, endsAt: window.endsAt };
	}

	room.activeMeetingToken = token;
};
