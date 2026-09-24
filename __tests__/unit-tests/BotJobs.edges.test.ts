import 'jest';
import Room from '../../src/Room';
import { Peer, PeerContext } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import BreakoutRoom from '../../src/BreakoutRoom';
import { BOT_JOB_TIMERS, MAX_ACTIVE_BOT_JOBS } from '../../src/BotJobs';
import { BotProvider, asBotProviders, asBotRecipients, asBotTypes, asJobId, asProviderBotJobs, asRecipientIds } from '../../src/common/botProfile';
import { Permission } from '../../src/common/authorization';
import { createJoinMiddleware } from '../../src/middlewares/joinMiddleware';
import * as providerClient from '../../src/common/botProviderClient';

jest.mock('../../src/common/botProviderClient', () => ({
	startProviderJob: jest.fn(async () => undefined),
	stopProviderJob: jest.fn(async () => undefined),
	getProviderBotJobs: jest.fn(async () => []),
}));

const startProviderJob = providerClient.startProviderJob as jest.Mock;
const stopProviderJob = providerClient.stopProviderJob as jest.Mock;
const getProviderBotJobs = providerClient.getProviderBotJobs as jest.Mock;

const recorder: BotProvider = { credentialId: 7, label: 'Acme Recorder', jobTypes: [ 'recorder' ], apiUrl: 'https://rec.example.com', apiSecret: 'key' };
const created: Peer[] = [];

const makeRoom = (providers: BotProvider[] = [ recorder ]): Room => {
	const room = new Room({ id: 'r', tenantId: 1, tenantFqdn: 'meet.example.org', mediaService: {} as unknown as MediaService });

	room.botProviders = providers;

	return room;
};

const makeHuman = (room: Room, moderator = true): Peer => {
	const peer = new Peer({ id: `h-${created.length}`, sessionId: room.sessionId, reconnectKey: 'k', managedId: moderator ? `u-${created.length}` : undefined });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	if (moderator) peer.permissions = [ Permission.MODERATE_ROOM, Permission.CREATE_ROOM ];
	created.push(peer);
	room.joinPeer(peer);

	return peer;
};

const makeBot = (room: Room, botId: string, botSessionId?: string): Peer => {
	const peer = new Peer({ id: `b-${created.length}`, sessionId: room.sessionId, reconnectKey: 'k', headless: true, botVerified: true, botType: 'recorder', botSessionId, botId });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	created.push(peer);

	return peer;
};

const request = async (peer: Peer, method: string, data: Record<string, unknown> = {}): Promise<PeerContext> => {
	const context = { peer, message: { method, data }, response: {}, handled: false } as unknown as PeerContext;

	await peer.pipeline.execute(context);

	return context;
};

const state = (room: Room, jobId: string) => room.botJobs.active.find((j) => j.id === jobId)?.state;
const methods = (peer: Peer) => (peer.notify as jest.Mock).mock.calls.map(([ n ]) => n.method);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const lastBotId = (): string => startProviderJob.mock.calls[startProviderJob.mock.calls.length - 1][1].botId;

const running = async (room = makeRoom()) => {
	const anna = makeHuman(room);
	const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
	const jobId = response.jobId as string;

	await flush();

	const botId = lastBotId();
	const bot = makeBot(room, botId);

	await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' });
	room.joinPeer(bot);
	await request(bot, 'botStatus', { state: 'running' });

	return { room, anna, jobId, bot, botId };
};

beforeEach(() => {
	jest.useFakeTimers();
	startProviderJob.mockReset();
	startProviderJob.mockImplementation(async () => undefined);
	stopProviderJob.mockClear();
	getProviderBotJobs.mockReset();
	getProviderBotJobs.mockImplementation(async () => []);
});

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
	jest.useRealTimers();
});

describe('starting a bot job, the edges', () => {
	test('is refused in a room that has no host to send the bot to', async () => {
		const room = makeRoom();

		room.tenantFqdn = undefined;
		await expect(request(makeHuman(room), 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('room has no host');
		expect(startProviderJob).not.toHaveBeenCalled();
	});

	test('tells the provider to stop again when the job was stopped while the provider was still answering', async () => {
		let accept: () => void = () => undefined;

		startProviderJob.mockImplementation(() => new Promise<void>((resolve) => { accept = resolve; }));

		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await request(anna, 'moderator:stopBotJob', { jobId: response.jobId });
		expect(stopProviderJob).toHaveBeenCalledTimes(1);

		accept();
		for (let i = 0; i < 20; i++) await Promise.resolve();
		expect(stopProviderJob).toHaveBeenCalledTimes(2);
	});

	test('does not fail a job twice when the provider refuses after the join timeout', async () => {
		// eslint-disable-next-line no-unused-vars
		let refuse: (e: Error) => void = () => undefined;

		startProviderJob.mockImplementation(() => new Promise<void>((_, reject) => { refuse = reject; }));

		const room = makeRoom();
		const anna = makeHuman(room);

		await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.join + 1);
		refuse(new Error('late'));
		for (let i = 0; i < 20; i++) await Promise.resolve();

		expect(methods(anna).filter((m) => m === 'botJobFailed')).toHaveLength(1);
	});

	test('counts only the jobs that are not over towards the cap', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const ids: string[] = [];

		for (let i = 0; i < MAX_ACTIVE_BOT_JOBS; i++) {
			anna.sessionId = `s-${i}`;
			ids.push((await request(anna, 'moderator:startBotJob', { type: 'recorder' })).response.jobId as string);
		}

		anna.sessionId = 's-last';
		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('too many bot jobs');
		await request(anna, 'moderator:stopBotJob', { jobId: ids[0] });
		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).resolves.toBeDefined();
	});
});

describe('stopping a bot job, the edges', () => {
	test('can be asked twice, and tells the provider once', async () => {
		const { anna, jobId } = await running();

		await request(anna, 'moderator:stopBotJob', { jobId });
		await request(anna, 'moderator:stopBotJob', { jobId });
		expect(stopProviderJob).toHaveBeenCalledTimes(1);
	});

	test('is refused for a job that does not exist, is over, or has no proper id', async () => {
		const { anna, jobId, bot } = await running();

		await expect(request(anna, 'moderator:stopBotJob', { jobId: '5b2f1c1e-0000-4000-8000-000000000000' })).rejects.toThrow('no such bot job');
		await expect(request(anna, 'moderator:stopBotJob', { jobId: '../etc' })).rejects.toThrow('no such bot job');
		await expect(request(anna, 'moderator:stopBotJob', {})).rejects.toThrow('no such bot job');

		await request(anna, 'moderator:stopBotJob', { jobId });
		bot.close();
		await expect(request(anna, 'moderator:stopBotJob', { jobId })).rejects.toThrow('no such bot job');
	});

	test('no longer listens to the bot once it is stopping', async () => {
		const { room, anna, jobId, bot } = await running();

		await request(anna, 'moderator:stopBotJob', { jobId });
		await request(bot, 'botStatus', { state: 'running' });
		await request(bot, 'botStatus', { state: 'failed', reason: 'too late' });

		expect(state(room, jobId)).toBe('stopping');
		expect(methods(anna)).not.toContain('botJobFailed');
	});

	test('happens to the jobs of a breakout room that is emptied', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);

		anna.sessionId = breakout.sessionId;

		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await flush();

		const bot = makeBot(room, lastBotId(), breakout.sessionId);

		await room.botJobs.admit({ botId: lastBotId(), credentialId: 7, botType: 'recorder', sessionId: breakout.sessionId });
		room.joinPeer(bot);
		anna.sessionId = room.sessionId;

		await request(anna, 'ejectBreakoutRoom', { roomSessionId: breakout.sessionId });

		expect(stopProviderJob).toHaveBeenCalledTimes(1);
		expect(bot.closed).toBe(true);
		expect(state(room, response.jobId as string)).toBeUndefined();
		expect(methods(anna)).not.toContain('botJobFailed');
	});

	test('does not touch the jobs of the other sessions', async () => {
		const { room, jobId } = await running();

		room.botJobs.stopSession('some-other-session');
		expect(state(room, jobId)).toBe('running');
		expect(stopProviderJob).not.toHaveBeenCalled();
	});
});

describe('the bot of a job, the edges', () => {
	test('is closed by the room server when it says it has finished and then stays', async () => {
		const { room, jobId, bot } = await running();

		await request(bot, 'botStatus', { state: 'finished' });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.leave + 1);

		expect(bot.closed).toBe(true);
		expect(state(room, jobId)).toBeUndefined();
		expect(stopProviderJob).not.toHaveBeenCalled();
	});

	test('fails with a plain reason when it gives none, or gives something that is no text', async () => {
		for (const reason of [ undefined, '', 42, { a: 1 } ]) {
			const { anna, bot } = await running();

			await request(bot, 'botStatus', { state: 'failed', reason });

			const notice = (anna.notify as jest.Mock).mock.calls.map(([ n ]) => n).find((n) => n.method === 'botJobFailed');

			expect(notice.data.reason).toBe('failed');
		}
	});

	test('is ignored when it reports a state that does not exist', async () => {
		const { room, jobId, bot } = await running();

		await request(bot, 'botStatus', { state: 'exploded' });
		await request(bot, 'botStatus', {});
		expect(state(room, jobId)).toBe('running');
	});

	test('cannot stretch its silence allowance by reporting many times a second', async () => {
		const { room, jobId, bot } = await running();

		// the first report armed the timer; reports within the same second change nothing
		jest.advanceTimersByTime(500);
		await request(bot, 'botStatus', { state: 'running' });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.heartbeat - 400);

		expect(state(room, jobId)).toBeUndefined();
	});

	test('is not told about jobs, and neither is a participant of another session', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const elsewhere = makeHuman(room, false);

		elsewhere.sessionId = breakout.sessionId;
		(elsewhere.notify as jest.Mock).mockClear();

		const { bot } = await running(room);

		expect(methods(bot)).not.toContain('botJobs');
		expect(methods(elsewhere)).not.toContain('botJobs');
	});

	test('resumes as joined when it dropped out before it ever ran', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		await flush();

		const botId = lastBotId();
		const bot = makeBot(room, botId);

		await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' });
		room.joinPeer(bot);
		bot.close();
		expect(state(room, jobId)).toBe('interrupted');

		const back = makeBot(room, botId);

		await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' });
		room.joinPeer(back);
		expect(state(room, jobId)).toBe('joined');
	});

	test('is not attached to a bot that is already over', async () => {
		const { room, anna, jobId, bot, botId } = await running();

		await request(anna, 'moderator:stopBotJob', { jobId });
		bot.close();

		const late = makeBot(room, botId);

		room.joinPeer(late);
		expect(room.botJobs.active).toEqual([]);
		expect((await request(late, 'botStatus', { state: 'running' })).handled).toBe(true);
		expect(room.botJobs.active).toEqual([]);
	});
});

describe('a bot the room server does not know, the edges', () => {
	const unknown = '5b2f1c1e-0000-4000-8000-000000000000';

	test('is not taken over from a bot that says it is a kind its key is not for', async () => {
		const room = makeRoom();

		makeHuman(room);
		expect(await room.botJobs.admit({ botId: unknown, credentialId: 7, botType: 'streamer' })).toEqual({ known: false });
		expect(getProviderBotJobs).not.toHaveBeenCalled();
	});

	test('is taken over into the breakout room the bot was sent to', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);
		makeHuman(room);
		getProviderBotJobs.mockImplementation(async () => [ { jobId: '6c3a2d2f-0000-4000-8000-00000000000a', type: 'recorder' } ]);

		expect(await room.botJobs.admit({ botId: unknown, credentialId: 7, botType: 'recorder', sessionId: breakout.sessionId })).toEqual({ known: true });
		expect(room.botJobs.inSession(breakout.sessionId)).toHaveLength(1);
		expect(room.botJobs.inSession(room.sessionId)).toHaveLength(0);
	});

	test('takes over no more jobs than the room may run', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);

		for (let i = 0; i < MAX_ACTIVE_BOT_JOBS; i++) {
			anna.sessionId = `s-${i}`;
			await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		}

		getProviderBotJobs.mockImplementation(async () => [ { jobId: '6c3a2d2f-0000-4000-8000-00000000000a', type: 'recorder' } ]);
		expect(await room.botJobs.admit({ botId: unknown, credentialId: 7, sessionId: 's-other' })).toEqual({ known: true, rejection: 'jobNotActive' });
	});

	test('forgets the oldest finished bots and jobs rather than remembering every one', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		let first = '';

		for (let i = 0; i < 120; i++) {
			const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

			await flush();
			if (!first) first = lastBotId();
			await request(anna, 'moderator:stopBotJob', { jobId: response.jobId });
		}

		// long forgotten, so it reads as a bot this room server never knew
		expect(await room.botJobs.admit({ botId: first, credentialId: 99, botType: 'recorder' })).toEqual({ known: false });
	});
});

describe('what the management server hands over', () => {
	test('is kept only where it is a provider that can be called', () => {
		const good = { credentialId: '7', label: 'Acme', jobTypes: [ 'streamer', 'recorder' ], apiUrl: 'https://rec.example.com', apiSecret: 'key' };

		expect(asBotProviders([ good ])).toEqual([ { credentialId: 7, label: 'Acme', jobTypes: [ 'recorder', 'streamer' ], apiUrl: 'https://rec.example.com', apiSecret: 'key' } ]);
		expect(asBotProviders([ { ...good, label: '' } ])[0].label).toBe('Bot');
		expect(asBotProviders([ { ...good, jobTypes: [ 'dancer', 'recorder' ] } ])[0].jobTypes).toEqual([ 'recorder' ]);

		for (const bad of [ { ...good, jobTypes: [ 'dancer' ] }, { ...good, jobTypes: [] }, { ...good, jobTypes: 'recorder' }, { ...good, jobTypes: undefined }, { ...good, apiUrl: 'http://rec.example.com' }, { ...good, apiUrl: undefined }, { ...good, apiSecret: '' }, { ...good, apiSecret: 5 }, { ...good, credentialId: 'x' }, { ...good, credentialId: 0 }, null, 'row' ])
			expect(asBotProviders([ bad ])).toEqual([]);

		for (const notAList of [ undefined, null, {}, 'rows', { data: [ good ] } ]) expect(asBotProviders(notAList)).toEqual([]);
	});

	test('a list of kinds holds the known ones, each once, in a fixed order', () => {
		expect(asBotTypes([ 'streamer', 'recorder', 'streamer', 'dancer' ])).toEqual([ 'recorder', 'streamer' ]);
		for (const nothing of [ undefined, null, 'recorder', {}, [] ]) expect(asBotTypes(nothing)).toEqual([]);
	});

	test('what a provider says a returning bot runs is kept only where it names a job and a kind', () => {
		const good = { jobId: '6C3A2D2F-0000-4000-8000-00000000000A', type: 'recorder' };

		expect(asProviderBotJobs({ jobs: [ good, { jobId: 'x', type: 'recorder' }, { jobId: good.jobId, type: 'dancer' }, null, 'job' ] }))
			.toEqual([ { jobId: '6c3a2d2f-0000-4000-8000-00000000000a', type: 'recorder' } ]);
		for (const nothing of [ undefined, null, {}, [], { jobs: 'x' }, [ good ] ]) expect(asProviderBotJobs(nothing)).toEqual([]);
	});

	test('a job id is a uuid and nothing else', () => {
		expect(asJobId('5B2F1C1E-0000-4000-8000-000000000000')).toBe('5b2f1c1e-0000-4000-8000-000000000000');

		for (const bad of [ undefined, '', 'job-1', '5b2f1c1e00004000800000000000000', '5b2f1c1e-0000-4000-8000-000000000000/..', [ '5b2f1c1e-0000-4000-8000-000000000000' ] ])
			expect(asJobId(bad)).toBeUndefined();
	});
});

describe('a peer whose connection dropped', () => {
	const connection = (disconnected: boolean) => ({ disconnected, on: jest.fn(), once: jest.fn(), close: jest.fn(), notify: jest.fn() });

	test('counts as lost only when every connection it has is waiting to come back', () => {
		const peer = new Peer({ id: 'p', sessionId: 's', reconnectKey: 'k' });

		created.push(peer);
		expect(peer.connectionLost).toBe(false);

		peer.connections.add(connection(true) as never);
		expect(peer.connectionLost).toBe(true);

		peer.connections.add(connection(false) as never);
		expect(peer.connectionLost).toBe(false);
	});
});

describe('the join response', () => {
	const join = async (room: Room, peer: Peer) => {
		const context = { peer, message: { method: 'join', data: { displayName: 'x' } }, response: {}, handled: false } as unknown as PeerContext;

		jest.spyOn(room, 'joinPeer').mockImplementation(() => undefined);
		await createJoinMiddleware({ room })(context, async () => undefined);

		return context.response as Record<string, unknown>;
	};
	const newPeer = (options: Partial<ConstructorParameters<typeof Peer>[0]> = {}) => {
		const peer = new Peer({ id: `j-${created.length}`, sessionId: 's', reconnectKey: 'k', ...options });

		created.push(peer);

		return peer;
	};

	test('names the providers without their address or key, and the jobs of the session', async () => {
		const response = await join(makeRoom(), newPeer());

		expect(response.botProviders).toEqual([ { id: 7, label: 'Acme Recorder', jobTypes: [ 'recorder' ] } ]);
		expect(response.botJobs).toEqual([]);
		expect(JSON.stringify(response)).not.toContain('rec.example.com');
		expect(JSON.stringify(response)).not.toContain('"key"');
	});

	test('says nothing of bots to a bot, or in a room without providers', async () => {
		expect('botProviders' in await join(makeRoom(), newPeer({ headless: true }))).toBe(false);
		expect('botProviders' in await join(makeRoom([]), newPeer())).toBe(false);
		expect('botJobs' in await join(makeRoom([]), newPeer())).toBe(false);
	});
});

describe('what a users lookup is made of and gives back', () => {
	test('asks for each positive integer id once, however it was written', () => {
		expect(asRecipientIds([ '7', '7', ' 8 ', '0', '-1', 'x', '', '9.5', '10' ])).toEqual([ 7, 8, 10 ]);
		expect(asRecipientIds([])).toEqual([]);
	});

	test('keeps only the rows that carry an address, from a page or a plain list', () => {
		const rows = [ { id: 1, email: ' a@example.org ' }, { id: 2, email: '' }, { id: 3, email: '   ' }, { id: 4 }, { id: 5, email: 5 }, null ];

		// trimmed: an address with stray whitespace around it is not one a provider can send to
		expect(asBotRecipients(rows)).toEqual([ { email: 'a@example.org' } ]);
		expect(asBotRecipients({ total: 1, data: rows })).toEqual([ { email: 'a@example.org' } ]);
		for (const nothing of [ undefined, null, {}, 'rows', { data: 'rows' } ]) expect(asBotRecipients(nothing)).toEqual([]);
	});
});
