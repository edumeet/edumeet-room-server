import { FOUNDER_TIMEOUT_MS, JOINER_TIMEOUT_MS, MlsGroup } from '../../../src/mls/MlsGroup';

test('The first peer to ask founds the group and later peers wait until it has published', () => {
	const group = new MlsGroup();

	expect(group.join('alice', 1000)).toEqual({ role: 'founder' });
	expect(group.join('bob', 1001)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
	expect(group.founder).toBe('alice');

	expect(group.publish('bob', 0, 'gi-bob')).toBe(false);
	expect(group.publish('alice', 3, 'gi-alice')).toBe(false);
	expect(group.exists).toBe(false);

	expect(group.publish('alice', 0, 'gi-alice')).toBe(true);
	expect(group.exists).toBe(true);
	expect(group.epoch).toBe(0);
	expect(group.founder).toBeUndefined();

	expect(group.join('bob', 1002)).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi-alice' });
});

test('A founder that asks again keeps its role and its deadline restarts, and a founder that never publishes times out', () => {
	const group = new MlsGroup();

	expect(group.join('alice', 1000)).toEqual({ role: 'founder' });
	expect(group.join('alice', 1500)).toEqual({ role: 'founder' });
	expect(group.join('bob', 1500 + FOUNDER_TIMEOUT_MS - 1)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
	expect(group.join('bob', 1500 + FOUNDER_TIMEOUT_MS)).toEqual({ role: 'founder' });
	expect(group.founder).toBe('bob');

	expect(group.publish('alice', 0, 'gi-alice')).toBe(false);
	expect(group.publish('bob', 0, 'gi-bob')).toBe(true);
});

test('A founder that leaves before publishing frees the role at once', () => {
	const group = new MlsGroup();

	group.join('alice', 1000);
	group.removePeer('alice');

	expect(group.join('bob', 1001)).toEqual({ role: 'founder' });
});

test('Commits are accepted only when built on the current epoch, and the first of two concurrent ones wins', () => {
	const group = new MlsGroup();

	expect(group.commit('alice', 0, 'gi')).toEqual({ accepted: false, epoch: -1 });

	group.join('alice', 1000);
	group.publish('alice', 0, 'gi0');

	expect(group.commit('alice', 0, 'gi1')).toEqual({ accepted: true, epoch: 1 });
	expect(group.commit('bob', 0, 'gi1-bob')).toEqual({ accepted: false, epoch: 1 });
	expect(group.epoch).toBe(1);
	expect(group.join('carol', 2000)).toEqual({ role: 'joiner', epoch: 1, groupInfo: 'gi1' });

	expect(group.commit('bob', 2, 'gi-future')).toEqual({ accepted: false, epoch: 1 });
	expect(group.commit('bob', 1, 'gi2')).toEqual({ accepted: true, epoch: 2 });
	expect(group.join('dave', 3000)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
	expect(group.join('carol', 3001)).toEqual({ role: 'joiner', epoch: 2, groupInfo: 'gi2' });
	expect(group.commit('carol', 2, 'gi3')).toEqual({ accepted: true, epoch: 3 });
	expect(group.join('dave', 3002)).toEqual({ role: 'joiner', epoch: 3, groupInfo: 'gi3' });
});

test('A GroupInfo can be restated for the current epoch, and only by the member that produced it', () => {
	const group = new MlsGroup();

	group.join('alice', 1000);
	group.publish('alice', 0, 'gi0');
	expect(group.publish('alice', 0, 'gi0-again')).toBe(true);
	expect(group.publish('bob', 0, 'not-mine')).toBe(false);

	group.commit('bob', 0, 'gi1');

	expect(group.publish('bob', 0, 'stale')).toBe(false);
	expect(group.publish('alice', 1, 'not-mine-either')).toBe(false);
	expect(group.publish('bob', 1, 'fresh')).toBe(true);
	expect(group.join('carol', 2000)).toEqual({ role: 'joiner', epoch: 1, groupInfo: 'fresh' });
});

test('Key packages are kept per peer until the peer leaves, and reset clears everything', () => {
	const group = new MlsGroup();

	group.storeKeyPackage('alice', 'kp-a');
	group.storeKeyPackage('bob', 'kp-b');
	group.storeKeyPackage('bob', 'kp-b2');

	expect(group.keyPackages()).toEqual({ alice: 'kp-a', bob: 'kp-b2' });

	group.removePeer('bob');

	expect(group.keyPackages()).toEqual({ alice: 'kp-a' });

	group.join('alice', 1000);
	group.publish('alice', 0, 'gi0');
	group.reset();

	expect(group.exists).toBe(false);
	expect(group.epoch).toBeUndefined();
	expect(group.keyPackages()).toEqual({});
	expect(group.join('carol', 2000)).toEqual({ role: 'founder' });
});

test('Joiners are admitted one at a time: the next gets its turn when the current one commits, leaves or times out', () => {
	const group = new MlsGroup();

	group.join('alice', 1000);
	group.publish('alice', 0, 'gi0');

	expect(group.join('bob', 2000)).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi0' });
	expect(group.join('carol', 2001)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
	expect(group.join('bob', 2002)).toEqual({ role: 'joiner', epoch: 0, groupInfo: 'gi0' });

	expect(group.commit('alice', 0, 'gi1')).toEqual({ accepted: true, epoch: 1 });
	expect(group.join('carol', 2003)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
	expect(group.join('bob', 2004)).toEqual({ role: 'joiner', epoch: 1, groupInfo: 'gi1' });

	expect(group.commit('bob', 1, 'gi2')).toEqual({ accepted: true, epoch: 2 });
	expect(group.join('carol', 2005)).toEqual({ role: 'joiner', epoch: 2, groupInfo: 'gi2' });
	expect(group.join('dave', 2006)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });

	group.removePeer('carol');
	expect(group.join('dave', 2007)).toEqual({ role: 'joiner', epoch: 2, groupInfo: 'gi2' });

	expect(group.join('dave', 2007 + JOINER_TIMEOUT_MS - 2)).toEqual({ role: 'joiner', epoch: 2, groupInfo: 'gi2' });
	expect(group.join('erin', 2007 + JOINER_TIMEOUT_MS - 1)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
	expect(group.join('erin', 2007 + JOINER_TIMEOUT_MS)).toEqual({ role: 'joiner', epoch: 2, groupInfo: 'gi2' });
	expect(group.join('dave', 2008 + JOINER_TIMEOUT_MS)).toEqual({ role: 'wait', retryAfterMs: expect.any(Number) });
});
