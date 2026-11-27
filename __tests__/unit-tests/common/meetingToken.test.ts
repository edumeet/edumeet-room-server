import 'jest';
import { admitMeetingToken, asTokenWindow, normalizeMeetingToken, releaseMeetingToken, MeetingTokenGate, MeetingTokenLookup } from '../../../src/common/meetingToken';

const gate = (over: Partial<MeetingTokenGate> = {}): MeetingTokenGate => ({
	meetingsOnly: true,
	validateMeetingToken: jest.fn(async (token: string) => ({ found: token === 'GOOD' })),
	...over
});

describe('normalizeMeetingToken()', () => {
	it('trims and uppercases what the client sent', () => {
		expect(normalizeMeetingToken('  abcdefghjklm ')).toBe('ABCDEFGHJKLM');
	});

	it('treats empty, missing and non-string values as absent', () => {
		expect(normalizeMeetingToken('')).toBeUndefined();
		expect(normalizeMeetingToken('   ')).toBeUndefined();
		expect(normalizeMeetingToken(undefined)).toBeUndefined();
		expect(normalizeMeetingToken([ 'A' ])).toBeUndefined();
	});
});

describe('admitMeetingToken()', () => {
	it('admits everyone when the room is not meetings only, without asking management', async () => {
		const room = gate({ meetingsOnly: false });

		await expect(admitMeetingToken(room, undefined)).resolves.toBeUndefined();
		expect(room.validateMeetingToken).not.toHaveBeenCalled();
	});

	it('requires a token', async () => {
		await expect(admitMeetingToken(gate(), undefined)).resolves.toEqual({ reason: 'required' });
	});

	it('binds the room to the first joiner\'s meeting after one lookup', async () => {
		const room = gate();

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('GOOD');
		expect(room.validateMeetingToken).toHaveBeenCalledTimes(1);
	});

	it('rejects a first joiner whose token belongs to no meeting of the room', async () => {
		const room = gate();

		await expect(admitMeetingToken(room, 'BAD')).resolves.toEqual({ reason: 'invalid' });
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('compares later joiners in memory, without another lookup', async () => {
		const room = gate({ activeMeetingToken: 'GOOD' });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.validateMeetingToken).not.toHaveBeenCalled();
	});

	it('rejects the token of a different meeting of the same room once bound', async () => {
		const room = gate({ activeMeetingToken: 'GOOD', validateMeetingToken: async () => ({ found: true }) });

		await expect(admitMeetingToken(room, 'OTHER')).resolves.toEqual({ reason: 'invalid' });
	});

	it('refuses as invalid when a closed management service answers nothing', async () => {
		const room = gate({ validateMeetingToken: async () => undefined as never });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toEqual({ reason: 'invalid' });
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('fails closed when no validator is installed', async () => {
		await expect(admitMeetingToken(gate({ validateMeetingToken: undefined }), 'GOOD')).resolves.toEqual({ reason: 'invalid' });
	});

	it('lets a lookup failure propagate rather than admitting', async () => {
		const room = gate({ validateMeetingToken: async () => { throw new Error('mgmt down'); } });

		await expect(admitMeetingToken(room, 'GOOD')).rejects.toThrow('mgmt down');
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('lets the first of two racing first joiners bind and refuses the other', async () => {
		let release: () => void = () => undefined;
		const room = gate({
			validateMeetingToken: (token) => new Promise<MeetingTokenLookup>((resolve) => {
				if (token === 'A') resolve({ found: true });
				else release = () => resolve({ found: true });
			})
		});

		const second = admitMeetingToken(room, 'B');

		await expect(admitMeetingToken(room, 'A')).resolves.toBeUndefined();
		release();
		await expect(second).resolves.toEqual({ reason: 'invalid' });
		expect(room.activeMeetingToken).toBe('A');
	});

	it('refuses a token too early, with the meeting times, and does not bind the room', async () => {
		const room = gate({ validateMeetingToken: async () => ({ found: true, window: { state: 'early', startsAt: 1000, endsAt: 2000 } }) });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toEqual({ reason: 'early', startsAt: 1000, endsAt: 2000 });
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('refuses the token of a meeting that is over, with its times', async () => {
		const room = gate({ validateMeetingToken: async () => ({ found: true, window: { state: 'over', startsAt: 1000, endsAt: 2000 } }) });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toEqual({ reason: 'over', startsAt: 1000, endsAt: 2000 });
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it.each([ 'over', 'early' ] as const)('lets a reconnect back in when its meeting is %s, since the peer was in the room before, but does not bind the room', async (state) => {
		const room = gate({ validateMeetingToken: async () => ({ found: true, window: { state, startsAt: 1000, endsAt: 2000 } }) });

		await expect(admitMeetingToken(room, 'STALE', true)).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('so the invitees of the meeting that is on are not refused after such a reconnect', async () => {
		const windows: Record<string, MeetingTokenLookup> = {
			STALE: { found: true, window: { state: 'over', startsAt: 1000, endsAt: 2000 } },
			NOW: { found: true, window: { state: 'open', startsAt: 5000, endsAt: 6000 } },
		};
		const room = gate({ validateMeetingToken: async (token: string) => windows[token] ?? { found: false } });

		await admitMeetingToken(room, 'STALE', true);
		await expect(admitMeetingToken(room, 'NOW')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('NOW');
		await expect(admitMeetingToken(room, 'STALE')).resolves.toEqual({ reason: 'invalid' });
	});

	it('binds the room for a reconnect when the meeting is open', async () => {
		const room = gate({ validateMeetingToken: async () => ({ found: true, window: { state: 'open', startsAt: 1000, endsAt: 2000 } }) });

		await expect(admitMeetingToken(room, 'GOOD', true)).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('GOOD');
	});

	it('still refuses a reconnect with a token of no meeting of the room', async () => {
		await expect(admitMeetingToken(gate(), 'BAD', true)).resolves.toEqual({ reason: 'invalid' });
	});

	it('binds the room when the meeting is open', async () => {
		const room = gate({ validateMeetingToken: async () => ({ found: true, window: { state: 'open', startsAt: 1000, endsAt: 2000 } }) });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('GOOD');
	});

	it('binds the room when management sends no window, as an older management server does', async () => {
		const room = gate({ validateMeetingToken: async () => ({ found: true }) });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('GOOD');
	});

	it('admits a latecomer of the bound meeting without looking at the time again', async () => {
		const room = gate({ activeMeetingToken: 'GOOD', validateMeetingToken: jest.fn(async () => ({ found: true, window: { state: 'over' as const, startsAt: 1, endsAt: 2 } })) });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.validateMeetingToken).not.toHaveBeenCalled();
	});

	it('admits a joiner whose lookup was in flight when the mode was switched off', async () => {
		const room = gate({
			validateMeetingToken: async () => {
				room.meetingsOnly = false;

				return { found: false };
			}
		});

		await expect(admitMeetingToken(room, 'WHATEVER')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBeUndefined();
	});
});

describe('releaseMeetingToken()', () => {
	it('lets go of the token the room is bound to, so the next one is looked up again', async () => {
		const valid = new Set([ 'OLD' ]);
		const room = gate({ validateMeetingToken: jest.fn(async (token: string) => ({ found: valid.has(token) })) });

		await admitMeetingToken(room, 'OLD');
		expect(room.activeMeetingToken).toBe('OLD');

		// The organizer deletes the meeting and makes a new one.
		valid.delete('OLD');
		valid.add('NEW');
		expect(releaseMeetingToken(room, 'OLD')).toBe(true);
		expect(room.activeMeetingToken).toBeUndefined();

		await expect(admitMeetingToken(room, 'OLD')).resolves.toEqual({ reason: 'invalid' });
		await expect(admitMeetingToken(room, 'NEW')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('NEW');
	});

	it('before it, the deleted meeting keeps admitting and its replacement is refused', async () => {
		const valid = new Set([ 'OLD' ]);
		const room = gate({ validateMeetingToken: jest.fn(async (token: string) => ({ found: valid.has(token) })) });

		await admitMeetingToken(room, 'OLD');
		valid.delete('OLD');
		valid.add('NEW');

		await expect(admitMeetingToken(room, 'OLD')).resolves.toBeUndefined();
		await expect(admitMeetingToken(room, 'NEW')).resolves.toEqual({ reason: 'invalid' });
	});

	it('leaves a room bound to another meeting alone', async () => {
		const room = gate({ activeMeetingToken: 'OTHER' });

		expect(releaseMeetingToken(room, 'OLD')).toBe(false);
		expect(room.activeMeetingToken).toBe('OTHER');
	});

	it('compares the token as the gate does, and ignores an event without one', () => {
		expect(releaseMeetingToken(gate({ activeMeetingToken: 'OLD' }), ' old ')).toBe(true);
		expect(releaseMeetingToken(gate({ activeMeetingToken: 'OLD' }), undefined)).toBe(false);
		expect(releaseMeetingToken(gate(), undefined)).toBe(false);
	});
});

describe('asTokenWindow()', () => {
	it('takes a window with a known state and numeric times', () => {
		expect(asTokenWindow({ state: 'early', startsAt: 1, endsAt: 2 })).toEqual({ state: 'early', startsAt: 1, endsAt: 2 });
	});

	it('drops anything else, which then counts as open', () => {
		expect(asTokenWindow(undefined)).toBeUndefined();
		expect(asTokenWindow('open')).toBeUndefined();
		expect(asTokenWindow({ state: 'closed', startsAt: 1, endsAt: 2 })).toBeUndefined();
		expect(asTokenWindow({ state: 'early', startsAt: '1', endsAt: 2 })).toBeUndefined();
		expect(asTokenWindow({ state: 'over', startsAt: 1, endsAt: NaN })).toBeUndefined();
	});
});
