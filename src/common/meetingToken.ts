export type MeetingTokenRejection = 'required' | 'invalid';

export interface MeetingTokenGate {
	meetingsOnly: boolean;
	activeMeetingToken?: string;
	// eslint-disable-next-line no-unused-vars
	validateMeetingToken?: (token: string) => Promise<boolean>;
}

export const normalizeMeetingToken = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string') return undefined;

	const token = raw.trim().toUpperCase();

	return token.length > 0 ? token : undefined;
};

const compareWithActive = (room: MeetingTokenGate, token: string): MeetingTokenRejection | undefined =>
	(room.activeMeetingToken === token ? undefined : 'invalid');

export const admitMeetingToken = async (room: MeetingTokenGate, token?: string): Promise<MeetingTokenRejection | undefined> => {
	if (!room.meetingsOnly) return;
	if (!token) return 'required';
	if (room.activeMeetingToken) return compareWithActive(room, token);

	const valid = room.validateMeetingToken ? await room.validateMeetingToken(token) : false;

	if (!room.meetingsOnly) return;
	if (room.activeMeetingToken) return compareWithActive(room, token);
	if (!valid) return 'invalid';

	room.activeMeetingToken = token;
};
