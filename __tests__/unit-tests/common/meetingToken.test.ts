import 'jest';
import { admitMeetingToken, normalizeMeetingToken, MeetingTokenGate } from '../../../src/common/meetingToken';

const gate = (over: Partial<MeetingTokenGate> = {}): MeetingTokenGate => ({
	meetingsOnly: true,
	validateMeetingToken: jest.fn(async (token: string) => token === 'GOOD'),
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
		await expect(admitMeetingToken(gate(), undefined)).resolves.toBe('required');
	});

	it('binds the room to the first joiner\'s meeting after one lookup', async () => {
		const room = gate();

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBe('GOOD');
		expect(room.validateMeetingToken).toHaveBeenCalledTimes(1);
	});

	it('rejects a first joiner whose token belongs to no meeting of the room', async () => {
		const room = gate();

		await expect(admitMeetingToken(room, 'BAD')).resolves.toBe('invalid');
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('compares later joiners in memory, without another lookup', async () => {
		const room = gate({ activeMeetingToken: 'GOOD' });

		await expect(admitMeetingToken(room, 'GOOD')).resolves.toBeUndefined();
		expect(room.validateMeetingToken).not.toHaveBeenCalled();
	});

	it('rejects the token of a different meeting of the same room once bound', async () => {
		const room = gate({ activeMeetingToken: 'GOOD', validateMeetingToken: async () => true });

		await expect(admitMeetingToken(room, 'OTHER')).resolves.toBe('invalid');
	});

	it('fails closed when no validator is installed', async () => {
		await expect(admitMeetingToken(gate({ validateMeetingToken: undefined }), 'GOOD')).resolves.toBe('invalid');
	});

	it('lets a lookup failure propagate rather than admitting', async () => {
		const room = gate({ validateMeetingToken: async () => { throw new Error('mgmt down'); } });

		await expect(admitMeetingToken(room, 'GOOD')).rejects.toThrow('mgmt down');
		expect(room.activeMeetingToken).toBeUndefined();
	});

	it('lets the first of two racing first joiners bind and refuses the other', async () => {
		let release: () => void = () => undefined;
		const room = gate({
			validateMeetingToken: (token) => new Promise<boolean>((resolve) => {
				if (token === 'A') resolve(true);
				else release = () => resolve(true);
			})
		});

		const second = admitMeetingToken(room, 'B');

		await expect(admitMeetingToken(room, 'A')).resolves.toBeUndefined();
		release();
		await expect(second).resolves.toBe('invalid');
		expect(room.activeMeetingToken).toBe('A');
	});

	it('admits a joiner whose lookup was in flight when the mode was switched off', async () => {
		const room = gate({
			validateMeetingToken: async () => {
				room.meetingsOnly = false;

				return false;
			}
		});

		await expect(admitMeetingToken(room, 'WHATEVER')).resolves.toBeUndefined();
		expect(room.activeMeetingToken).toBeUndefined();
	});
});
