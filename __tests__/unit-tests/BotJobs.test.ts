import 'jest';
import Room from '../../src/Room';
import { Peer, PeerContext } from '../../src/Peer';
import MediaService from '../../src/MediaService';
import BreakoutRoom from '../../src/BreakoutRoom';
import { BOT_JOB_TIMERS, MAX_ACTIVE_BOT_JOBS } from '../../src/BotJobs';
import { BotProvider } from '../../src/common/botProfile';
import { Permission } from '../../src/common/authorization';
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
	const room = new Room({ id: 'lecture 1', tenantId: 1, tenantFqdn: 'meet.example.org', mediaService: {} as unknown as MediaService });

	room.botProviders = providers;

	return room;
};

const makeHuman = (room: Room, moderator = true): Peer => {
	const peer = new Peer({ id: `h-${created.length}`, sessionId: room.sessionId, reconnectKey: 'k', managedId: moderator ? `u-${created.length}` : undefined });

	jest.spyOn(peer, 'notify').mockImplementation(() => undefined);
	if (moderator) peer.permissions = [ Permission.MODERATE_ROOM ];
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
// The provider is called behind the moderator's answer, after the addresses are looked up.
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const botIdOf = (call = 0): string => startProviderJob.mock.calls[call][1].botId;
const lastJobs = (peer: Peer) => (peer.notify as jest.Mock).mock.calls.map(([ n ]) => n).filter((n) => n.method === 'botJobs')
	.pop()?.data.jobs;

beforeEach(() => {
	jest.useFakeTimers();
	startProviderJob.mockClear();
	startProviderJob.mockImplementation(async () => undefined);
	stopProviderJob.mockClear();
	getProviderBotJobs.mockReset();
	getProviderBotJobs.mockImplementation(async () => []);
});

afterEach(() => {
	for (const peer of created.splice(0)) if (!peer.closed) peer.close();
	jest.useRealTimers();
});

describe('starting a bot job', () => {
	test('calls the provider with the room and a url for the bot', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		await flush();
		expect(startProviderJob).toHaveBeenCalledTimes(1);

		const [ provider, body ] = startProviderJob.mock.calls[0];

		expect(provider).toBe(recorder);
		expect(body).toMatchObject({ jobId, type: 'recorder', botId: expect.any(String), room: { host: 'meet.example.org', roomId: 'lecture 1', sessionId: room.sessionId, mainSessionId: room.sessionId } });
		expect(body.botId).not.toBe(jobId);

		const url = new URL(body.room.url);

		expect(url.origin + url.pathname).toBe('https://meet.example.org/lecture%201');
		// a provider of one kind only names it; the page reads it
		expect(Object.fromEntries(url.searchParams)).toEqual({ headless: '1', botType: 'recorder', botId: body.botId, displayName: 'Acme Recorder' });
		expect(state(room, jobId)).toBe('starting');
		expect(lastJobs(anna)).toEqual([ { id: jobId, type: 'recorder', label: 'Acme Recorder', providerId: 7, state: 'starting', sessionId: room.sessionId } ]);
	});

	test('answers before the provider does, so a request the client repeats cannot start it twice', async () => {
		startProviderJob.mockImplementation(() => new Promise(() => undefined));

		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		expect(response.jobId).toEqual(expect.any(String));
		expect(room.botJobs.active).toHaveLength(1);
	});

	test('sends the bot to the host in lower case and without a trailing dot', async () => {
		const room = makeRoom();

		room.tenantFqdn = 'Meet.Example.org.';
		await request(makeHuman(room), 'moderator:startBotJob', { type: 'recorder' });
		await flush();

		const body = startProviderJob.mock.calls[0][1];

		expect(body.room.host).toBe('meet.example.org');
		expect(new URL(body.room.url).host).toBe('meet.example.org');
	});

	test('is for moderators, and only for a kind of job the tenant has a provider for', async () => {
		const room = makeRoom();
		const guest = makeHuman(room, false);
		const anna = makeHuman(room);

		await expect(request(guest, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('peer not authorized');
		await expect(request(anna, 'moderator:startBotJob', { type: 'streamer' })).rejects.toThrow('no such bot provider');
		await expect(request(anna, 'moderator:startBotJob', { type: 'dancer' })).rejects.toThrow('unknown bot job type');
		expect(startProviderJob).not.toHaveBeenCalled();
	});

	test('takes someone signed in, whatever their permissions', async () => {
		const room = makeRoom();
		const anonymous = new Peer({ id: 'anon', sessionId: room.sessionId, reconnectKey: 'k' });

		jest.spyOn(anonymous, 'notify').mockImplementation(() => undefined);
		anonymous.permissions = [ Permission.MODERATE_ROOM ];
		created.push(anonymous);
		room.joinPeer(anonymous);

		await expect(request(anonymous, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('peer not authorized');
		await expect(request(anonymous, 'moderator:stopBotJob', { jobId: '5b2f1c1e-0000-4000-8000-000000000000' })).rejects.toThrow('peer not authorized');
		expect(startProviderJob).not.toHaveBeenCalled();
	});

	test('needs the provider named when the tenant has two of a kind', async () => {
		const backup = { ...recorder, credentialId: 8, label: 'Backup Recorder' };
		const room = makeRoom([ recorder, backup ]);
		const anna = makeHuman(room);

		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('no such bot provider');
		await request(anna, 'moderator:startBotJob', { type: 'recorder', providerId: 8 });
		await flush();
		expect(startProviderJob.mock.calls[0][0]).toBe(backup);
	});

	test('is not offered in a room without providers', async () => {
		const room = makeRoom([]);
		const anna = makeHuman(room);
		const context = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		expect(context.handled).toBe(false);
	});

	test('fails the job, tells the provider and the moderators when the provider refuses', async () => {
		startProviderJob.mockImplementation(async () => { throw new Error('refused'); });

		const room = makeRoom();
		const anna = makeHuman(room);
		const guest = makeHuman(room, false);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await flush();
		expect(state(room, response.jobId as string)).toBeUndefined();
		expect(stopProviderJob).toHaveBeenCalledTimes(1);
		expect(anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ jobId: response.jobId, reason: 'providerError' }) });
		expect(guest.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'botJobFailed' }));
	});

	test('fails when the bot never joins', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		jest.advanceTimersByTime(BOT_JOB_TIMERS.join + 1);

		expect(state(room, response.jobId as string)).toBeUndefined();
		expect(anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ reason: 'joinTimeout' }) });
		expect(stopProviderJob).toHaveBeenCalledTimes(1);
	});

	test('stops at the cap of jobs a room may run', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);

		for (let i = 0; i < MAX_ACTIVE_BOT_JOBS; i++) {
			anna.sessionId = `s-${i}`;
			await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		}

		anna.sessionId = 's-last';
		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('too many bot jobs');
	});

	test('runs in the breakout room the moderator is in', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);

		anna.sessionId = breakout.sessionId;
		await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		await flush();

		const body = startProviderJob.mock.calls[0][1];

		// The main room's session goes along, so the provider can tie this recording to the meeting's.
		expect(body.room).toMatchObject({ sessionId: breakout.sessionId, mainSessionId: room.sessionId, sessionName: 'Group A' });
		expect(body.room.mainSessionId).not.toBe(breakout.sessionId);
		expect(new URL(body.room.url).searchParams.get('session')).toBe(breakout.sessionId);
	});
});

describe('the bot of a job', () => {
	const started = async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		return { room, anna, jobId };
	};

	const joined = async () => {
		const all = await started();

		await flush();

		const botId = botIdOf(startProviderJob.mock.calls.length - 1);
		const bot = makeBot(all.room, botId);

		expect(await all.room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
		all.room.joinPeer(bot);

		return { ...all, bot, botId };
	};

	test('moves the job on by joining and by reporting that it runs', async () => {
		const { room, anna, jobId, bot } = await joined();

		expect(state(room, jobId)).toBe('joined');
		expect(lastJobs(anna)[0]).toMatchObject({ state: 'joined', peerId: bot.id });

		await request(bot, 'botStatus', { state: 'running' });
		expect(state(room, jobId)).toBe('running');
	});

	test('must report that it runs, and keep reporting it', async () => {
		const first = await joined();

		jest.advanceTimersByTime(BOT_JOB_TIMERS.running + 1);
		expect(state(first.room, first.jobId)).toBeUndefined();
		expect(first.anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ reason: 'notRunning' }) });
		expect(first.bot.closed).toBe(true);

		const second = await joined();

		await request(second.bot, 'botStatus', { state: 'running' });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.heartbeat - 1_000);
		await request(second.bot, 'botStatus', { state: 'running' });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.heartbeat - 1_000);
		expect(state(second.room, second.jobId)).toBe('running');

		jest.advanceTimersByTime(2_000);
		expect(state(second.room, second.jobId)).toBeUndefined();
		expect(second.anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ reason: 'noHeartbeat' }) });
	});

	test('does not announce a heartbeat to the room', async () => {
		const { anna, bot } = await joined();

		await request(bot, 'botStatus', { state: 'running' });

		const announcements = (anna.notify as jest.Mock).mock.calls.length;

		jest.advanceTimersByTime(30_000);
		await request(bot, 'botStatus', { state: 'running' });
		expect((anna.notify as jest.Mock).mock.calls.length).toBe(announcements);
	});

	test('reports a failure with a reason that reaches the moderators capped', async () => {
		const { room, anna, jobId, bot } = await joined();

		await request(bot, 'botStatus', { state: 'failed', reason: 'x'.repeat(500) });

		expect(state(room, jobId)).toBeUndefined();
		expect(stopProviderJob).toHaveBeenCalledTimes(1);
		expect(bot.closed).toBe(true);

		const notice = (anna.notify as jest.Mock).mock.calls.map(([ n ]) => n).find((n) => n.method === 'botJobFailed');

		expect(notice.data.reason).toHaveLength(200);
	});

	test('ends the job cleanly by reporting it finished and leaving', async () => {
		const { room, jobId, bot } = await joined();

		await request(bot, 'botStatus', { state: 'running' });
		await request(bot, 'botStatus', { state: 'finished' });
		expect(state(room, jobId)).toBe('stopping');

		bot.close();
		expect(state(room, jobId)).toBeUndefined();
		expect(stopProviderJob).not.toHaveBeenCalled();
	});

	test('cannot speak for a bot that is not itself', async () => {
		const { room, jobId, botId } = await joined();
		const stranger = makeBot(room, botId);

		room.joinPeer(stranger);

		expect(stranger.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'jobNotActive' } });
		expect(stranger.closed).toBe(true);
		expect(state(room, jobId)).toBe('joined');
	});

	test('is not heard when it carries no job', async () => {
		const room = makeRoom();

		makeHuman(room);

		const plain = new Peer({ id: 'plain', sessionId: room.sessionId, reconnectKey: 'k', headless: true, botVerified: true });

		jest.spyOn(plain, 'notify').mockImplementation(() => undefined);
		created.push(plain);
		room.joinPeer(plain);

		expect((await request(plain, 'botStatus', { state: 'running' })).handled).toBe(false);
		expect((await request(plain, 'moderator:startBotJob', { type: 'recorder' })).handled).toBe(false);
	});

	test('drops a bot id that did not come from a verified bot', () => {
		const room = makeRoom();
		const generic = new Peer({ id: 'generic', sessionId: room.sessionId, reconnectKey: 'k', headless: true, botId: '5b2f1c1e-0000-4000-8000-000000000000' });

		created.push(generic);
		expect(generic.botId).toBeUndefined();
	});
});

describe('stopping a bot job', () => {
	const running = async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		await flush();

		const botId = botIdOf();
		const bot = makeBot(room, botId);

		await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });

		return { room, anna, jobId, bot, botId };
	};

	test('tells the provider and ends when the bot leaves', async () => {
		const { room, anna, jobId, bot } = await running();

		await request(anna, 'moderator:stopBotJob', { jobId });
		expect(stopProviderJob).toHaveBeenCalledWith(recorder, jobId);
		expect(state(room, jobId)).toBe('stopping');

		bot.close();
		expect(state(room, jobId)).toBeUndefined();
		expect(anna.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'botJobFailed' }));
	});

	test('closes a bot that does not leave', async () => {
		const { room, anna, jobId, bot } = await running();

		await request(anna, 'moderator:stopBotJob', { jobId });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.leave + 1);

		expect(bot.closed).toBe(true);
		expect(state(room, jobId)).toBeUndefined();
	});

	test('ends a job whose bot has not arrived yet, and refuses the bot when it does', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		await flush();

		const botId = botIdOf();

		await request(anna, 'moderator:stopBotJob', { jobId });
		expect(state(room, jobId)).toBeUndefined();
		expect(await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true, rejection: 'jobNotActive' });
		expect(getProviderBotJobs).not.toHaveBeenCalled();
	});

	test('is what kicking the bot does', async () => {
		const { room, anna, jobId, bot } = await running();

		await request(anna, 'moderator:kickPeer', { peerId: bot.id });

		expect(stopProviderJob).toHaveBeenCalledWith(recorder, jobId);
		expect(state(room, jobId)).toBeUndefined();
		expect(anna.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'botJobFailed' }));
	});

	test('is refused to a participant who is not a moderator', async () => {
		const { room, jobId } = await running();
		const guest = makeHuman(room, false);

		await expect(request(guest, 'moderator:stopBotJob', { jobId })).rejects.toThrow('peer not authorized');
	});

	test('happens to the jobs of a breakout room that is removed', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);

		anna.permissions = [ Permission.MODERATE_ROOM, Permission.CREATE_ROOM ];
		anna.sessionId = breakout.sessionId;

		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		await flush();

		const botId = botIdOf();
		const bot = makeBot(room, botId, breakout.sessionId);

		await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder', sessionId: breakout.sessionId });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });
		anna.sessionId = room.sessionId;

		await request(anna, 'removeBreakoutRoom', { roomSessionId: breakout.sessionId });

		expect(stopProviderJob).toHaveBeenCalledWith(recorder, jobId);
		expect(bot.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'sessionClosed' } });
		expect(state(room, jobId)).toBeUndefined();
		expect(anna.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'botJobFailed' }));
	});
});

describe('a bot job whose bot drops out', () => {
	const running = async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;

		await flush();

		const botId = botIdOf();
		const bot = makeBot(room, botId);

		await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });

		return { room, anna, jobId, bot, botId };
	};

	test('is interrupted, and runs on when the bot is back in time', async () => {
		const { room, jobId, bot, botId } = await running();

		bot.close();
		expect(state(room, jobId)).toBe('interrupted');

		// the heartbeat is not what fails an interrupted job
		jest.advanceTimersByTime(BOT_JOB_TIMERS.interrupted - 1_000);
		expect(state(room, jobId)).toBe('interrupted');

		const back = makeBot(room, botId);

		expect(await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
		room.joinPeer(back);
		expect(state(room, jobId)).toBe('running');

		jest.advanceTimersByTime(BOT_JOB_TIMERS.running + 1);
		expect(state(room, jobId)).toBeUndefined();
	});

	test('fails when the bot stays away', async () => {
		const { room, anna, jobId, bot } = await running();

		bot.close();
		jest.advanceTimersByTime(BOT_JOB_TIMERS.interrupted + 1);

		expect(state(room, jobId)).toBeUndefined();
		expect(anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ reason: 'interrupted' }) });
		expect(stopProviderJob).toHaveBeenCalledWith(recorder, jobId);
	});

	test('refuses a second page while its bot is connected, and lets a reloaded page take over', async () => {
		const { room, jobId, bot, botId } = await running();

		expect(await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true, rejection: 'jobNotActive' });

		jest.spyOn(bot, 'connectionLost', 'get').mockReturnValue(true);
		expect(await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
		expect(bot.closed).toBe(true);
		expect(state(room, jobId)).toBe('running');
	});

	test('refuses a bot that holds another provider\'s key, or comes for another session', async () => {
		const { room, botId } = await running();

		expect(await room.botJobs.admit({ botId, credentialId: 8, botType: 'recorder' })).toEqual({ known: true, rejection: 'botTokenRejected' });
		expect(await room.botJobs.admit({ botId, credentialId: 7, botType: 'recorder', sessionId: 'elsewhere' })).toEqual({ known: true, rejection: 'jobNotActive' });
	});
});

describe('a bot the room server does not know', () => {
	const unknown = '5b2f1c1e-0000-4000-8000-000000000000';
	const jobA = '6c3a2d2f-0000-4000-8000-00000000000a';
	const jobB = '6c3a2d2f-0000-4000-8000-00000000000b';
	const everything: BotProvider = { credentialId: 9, label: 'Acme', jobTypes: [ 'recorder', 'transcriber', 'streamer' ], apiUrl: 'https://acme.example.com', apiSecret: 'key' };

	test('is taken over with the jobs its provider says it runs, and nothing is started again', async () => {
		const room = makeRoom([ everything ]);
		const anna = makeHuman(room);

		getProviderBotJobs.mockImplementation(async () => [ { jobId: jobA, type: 'recorder' }, { jobId: jobB, type: 'transcriber' } ]);

		expect(await room.botJobs.admit({ botId: unknown, credentialId: 9 })).toEqual({ known: true });
		// the room goes with the question, so a bot cannot bring another room's jobs here
		expect(getProviderBotJobs).toHaveBeenCalledWith(everything, unknown, { host: 'meet.example.org', roomId: 'lecture 1' });
		expect(room.botJobs.active.map((job) => [ job.id, job.type, job.state ])).toEqual([ [ jobA, 'recorder', 'starting' ], [ jobB, 'transcriber', 'starting' ] ]);
		expect(startProviderJob).not.toHaveBeenCalled();

		const bot = makeBot(room, unknown);

		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });
		expect(lastJobs(anna).map((job: { state: string }) => job.state)).toEqual([ 'running', 'running' ]);
	});

	test('is no bot of a job at all when the key belongs to no provider of the room', async () => {
		const room = makeRoom();

		makeHuman(room);
		expect(await room.botJobs.admit({ botId: unknown, credentialId: 99, botType: 'recorder' })).toEqual({ known: false });
		expect(getProviderBotJobs).not.toHaveBeenCalled();
		expect(room.botJobs.active).toEqual([]);
	});

	test('is refused when its provider knows no jobs for it, cannot be reached, or answers nonsense, and is not asked about twice', async () => {
		for (const answer of [ async () => [], async () => { throw new Error('down'); } ]) {
			const room = makeRoom([ everything ]);

			makeHuman(room);
			getProviderBotJobs.mockReset();
			getProviderBotJobs.mockImplementation(answer);

			expect(await room.botJobs.admit({ botId: unknown, credentialId: 9 })).toEqual({ known: true, rejection: 'jobNotActive' });
			expect(await room.botJobs.admit({ botId: unknown, credentialId: 9 })).toEqual({ known: true, rejection: 'jobNotActive' });
			expect(getProviderBotJobs).toHaveBeenCalledTimes(1);
			expect(room.botJobs.active).toEqual([]);
		}
	});

	test('keeps only the jobs of kinds the provider offers, one of each, and none this room already knows', async () => {
		const room = makeRoom([ { ...everything, jobTypes: [ 'recorder', 'streamer' ] } ]);
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'streamer' });

		getProviderBotJobs.mockImplementation(async () => [
			{ jobId: jobA, type: 'transcriber' },
			{ jobId: response.jobId, type: 'recorder' },
			{ jobId: jobB, type: 'recorder' },
			{ jobId: '6c3a2d2f-0000-4000-8000-00000000000c', type: 'recorder' },
			{ jobId: '6c3a2d2f-0000-4000-8000-00000000000d', type: 'streamer' },
		]);

		await room.botJobs.admit({ botId: unknown, credentialId: 9 });

		expect(room.botJobs.active.map((job) => [ job.id, job.type ])).toEqual([ [ response.jobId, 'streamer' ], [ jobB, 'recorder' ] ]);
	});

	test('asks its provider once when two pages of it arrive at the same time', async () => {
		const room = makeRoom([ everything ]);
		let answer: () => void = () => undefined;

		makeHuman(room);
		getProviderBotJobs.mockImplementation(() => new Promise((resolve) => { answer = () => resolve([ { jobId: jobA, type: 'recorder' } ]); }));

		const first = room.botJobs.admit({ botId: unknown, credentialId: 9 });
		const second = room.botJobs.admit({ botId: unknown, credentialId: 9 });

		answer();

		expect(await first).toEqual({ known: true });
		expect(await second).toEqual({ known: true });
		expect(getProviderBotJobs).toHaveBeenCalledTimes(1);
		expect(room.botJobs.active).toHaveLength(1);
	});

	test('fails like any other when it then never joins', async () => {
		const room = makeRoom([ everything ]);
		const anna = makeHuman(room);

		getProviderBotJobs.mockImplementation(async () => [ { jobId: jobA, type: 'recorder' } ]);
		await room.botJobs.admit({ botId: unknown, credentialId: 9 });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.join + 1);

		expect(room.botJobs.active).toEqual([]);
		expect(anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ jobId: jobA, reason: 'joinTimeout' }) });
	});
});

describe('one bot for several kinds of job', () => {
	const everything: BotProvider = { credentialId: 9, label: 'Acme', jobTypes: [ 'recorder', 'transcriber', 'streamer' ], apiUrl: 'https://acme.example.com', apiSecret: 'key' };

	const withBot = async () => {
		const room = makeRoom([ everything ]);
		const anna = makeHuman(room);
		const recording = (await request(anna, 'moderator:startBotJob', { type: 'recorder' })).response.jobId as string;

		await flush();

		const botId = botIdOf();
		const bot = makeBot(room, botId);

		await room.botJobs.admit({ botId, credentialId: 9 });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });

		const transcript = (await request(anna, 'moderator:startBotJob', { type: 'transcriber' })).response.jobId as string;

		await flush();

		return { room, anna, bot, botId, recording, transcript };
	};

	test('sends a second kind to the bot that is already there, which does it at once', async () => {
		const { room, botId, recording, transcript } = await withBot();

		expect(startProviderJob).toHaveBeenCalledTimes(2);
		expect(startProviderJob.mock.calls[1][1]).toMatchObject({ jobId: transcript, type: 'transcriber', botId });
		expect(state(room, recording)).toBe('running');
		expect(state(room, transcript)).toBe('running');
	});

	test('names no kind in the address of a bot that does several, so it takes video too', async () => {
		await withBot();
		const url = new URL(startProviderJob.mock.calls[0][1].room.url);

		expect(url.searchParams.has('botType')).toBe(false);
		expect(url.searchParams.get('botId')).toBe(startProviderJob.mock.calls[0][1].botId);
	});

	test('runs one job of each kind in a session, and a kind again once it has stopped', async () => {
		const { anna, recording } = await withBot();

		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('bot job already running');

		await request(anna, 'moderator:stopBotJob', { jobId: recording });
		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).resolves.toBeDefined();
	});

	test('stops one job at its provider and keeps the bot for the others', async () => {
		const { room, bot, recording, transcript } = await withBot();

		await request(room.peers.items[0], 'moderator:stopBotJob', { jobId: transcript });

		expect(stopProviderJob).toHaveBeenCalledTimes(1);
		expect(stopProviderJob).toHaveBeenCalledWith(everything, transcript);
		expect(state(room, transcript)).toBeUndefined();
		expect(state(room, recording)).toBe('running');
		expect(bot.closed).toBe(false);
	});

	test('lets the bot go with its last job, and removes it when it stays', async () => {
		const { room, anna, bot, recording, transcript } = await withBot();

		await request(anna, 'moderator:stopBotJob', { jobId: transcript });
		await request(anna, 'moderator:stopBotJob', { jobId: recording });

		expect(state(room, recording)).toBe('stopping');

		jest.advanceTimersByTime(BOT_JOB_TIMERS.leave + 1);
		expect(bot.closed).toBe(true);
		expect(room.botJobs.active).toEqual([]);
	});

	test('gives a job that comes while the bot is leaving a bot of its own', async () => {
		const { anna, botId, recording, transcript } = await withBot();

		await request(anna, 'moderator:stopBotJob', { jobId: transcript });
		await request(anna, 'moderator:stopBotJob', { jobId: recording });
		await request(anna, 'moderator:startBotJob', { type: 'streamer' });
		await flush();

		expect(startProviderJob.mock.calls[2][1].botId).not.toBe(botId);
	});

	test('sends a bot to each session, each with its own id', async () => {
		const room = makeRoom([ everything ]);
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);

		await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		anna.sessionId = breakout.sessionId;
		await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		await flush();

		expect(botIdOf(0)).not.toBe(botIdOf(1));
	});

	test('hears which kind failed, and fails only that one', async () => {
		const { room, anna, bot, recording, transcript } = await withBot();

		await request(bot, 'botStatus', { state: 'failed', reason: 'transcription service down', type: 'transcriber' });

		expect(state(room, transcript)).toBeUndefined();
		expect(state(room, recording)).toBe('running');
		expect(stopProviderJob).toHaveBeenCalledWith(everything, transcript);
		expect(anna.notify).toHaveBeenCalledWith({ method: 'botJobFailed', data: expect.objectContaining({ jobId: transcript, type: 'transcriber' }) });
		expect(bot.closed).toBe(false);
	});

	test('sends the bot away when the only kind it had left fails', async () => {
		const { room, bot, recording, transcript } = await withBot();

		await request(room.peers.items[0], 'moderator:stopBotJob', { jobId: recording });
		await request(bot, 'botStatus', { state: 'failed', type: 'transcriber' });

		expect(bot.closed).toBe(true);
		expect(bot.notify).toHaveBeenCalledWith({ method: 'botRejected', data: { reason: 'jobNotActive' } });
		expect(state(room, transcript)).toBeUndefined();
	});

	test('hears which kind finished, without telling the provider what it already knows', async () => {
		const { room, bot, recording, transcript } = await withBot();

		await request(bot, 'botStatus', { state: 'finished', type: 'transcriber' });

		expect(state(room, transcript)).toBeUndefined();
		expect(state(room, recording)).toBe('running');
		expect(stopProviderJob).not.toHaveBeenCalled();
	});

	test('ignores a report about a kind it does not run', async () => {
		const { room, bot, recording, transcript } = await withBot();

		await request(bot, 'botStatus', { state: 'failed', type: 'streamer' });
		await request(bot, 'botStatus', { state: 'finished', type: 'dancer' });

		expect(state(room, recording)).toBe('running');
		expect(state(room, transcript)).toBe('running');
	});

	test('fails every job at once when the bot itself fails, and tells the moderators once', async () => {
		const { room, anna, bot, recording, transcript } = await withBot();

		(anna.notify as jest.Mock).mockClear();
		await request(bot, 'botStatus', { state: 'failed', reason: 'out of memory' });

		expect(room.botJobs.active).toEqual([]);
		expect(stopProviderJob.mock.calls.map(([ , id ]) => id).sort()).toEqual([ recording, transcript ].sort());
		expect((anna.notify as jest.Mock).mock.calls.filter(([ n ]) => n.method === 'botJobFailed')).toHaveLength(1);
		expect(bot.closed).toBe(true);
	});

	test('ends every job when the bot says it has finished altogether', async () => {
		const { room, bot } = await withBot();

		await request(bot, 'botStatus', { state: 'finished' });
		expect(room.botJobs.active.map((job) => job.state)).toEqual([ 'stopping', 'stopping' ]);

		bot.close();
		expect(room.botJobs.active).toEqual([]);
		expect(stopProviderJob).not.toHaveBeenCalled();
	});

	test('stops every job at its provider when the bot is removed', async () => {
		const { room, anna, bot, recording, transcript } = await withBot();

		await request(anna, 'moderator:kickPeer', { peerId: bot.id });

		expect(stopProviderJob.mock.calls.map(([ , id ]) => id).sort()).toEqual([ recording, transcript ].sort());
		expect(room.botJobs.active).toEqual([]);
		expect(anna.notify).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'botJobFailed' }));
	});

	test('fails a second kind that its provider refuses, and leaves the running one alone', async () => {
		const room = makeRoom([ everything ]);
		const anna = makeHuman(room);
		const recording = (await request(anna, 'moderator:startBotJob', { type: 'recorder' })).response.jobId as string;

		await flush();
		startProviderJob.mockImplementation(async () => { throw new Error('refused'); });

		const streaming = (await request(anna, 'moderator:startBotJob', { type: 'streamer' })).response.jobId as string;

		await flush();

		expect(state(room, streaming)).toBeUndefined();
		expect(state(room, recording)).toBe('starting');
	});

	test('carries every job through a drop-out of its bot, and back to running', async () => {
		const { room, botId, recording, transcript, bot } = await withBot();

		bot.close();
		expect([ state(room, recording), state(room, transcript) ]).toEqual([ 'interrupted', 'interrupted' ]);

		const back = makeBot(room, botId);

		expect(await room.botJobs.admit({ botId, credentialId: 9 })).toEqual({ known: true });
		room.joinPeer(back);
		expect([ state(room, recording), state(room, transcript) ]).toEqual([ 'running', 'running' ]);
	});

	test('fails every job of a bot that goes silent, tells the provider about each and the moderators once', async () => {
		const { room, anna, recording, transcript } = await withBot();

		(anna.notify as jest.Mock).mockClear();
		jest.advanceTimersByTime(BOT_JOB_TIMERS.heartbeat + 1);

		expect(room.botJobs.active).toEqual([]);
		expect(stopProviderJob.mock.calls.map(([ , id ]) => id).sort()).toEqual([ recording, transcript ].sort());
		expect((anna.notify as jest.Mock).mock.calls.filter(([ n ]) => n.method === 'botJobFailed')).toEqual([
			[ { method: 'botJobFailed', data: expect.objectContaining({ reason: 'noHeartbeat' }) } ]
		]);
	});

	test('keeps its heartbeat when the bot names a kind with it', async () => {
		const { room, bot, recording } = await withBot();

		jest.advanceTimersByTime(BOT_JOB_TIMERS.heartbeat - 1_000);
		await request(bot, 'botStatus', { state: 'running', type: 'recorder' });
		jest.advanceTimersByTime(BOT_JOB_TIMERS.heartbeat - 1_000);

		expect(state(room, recording)).toBe('running');
	});

	test('lets the bot go gracefully when the last kind it had says it has finished', async () => {
		const { room, anna, bot, recording, transcript } = await withBot();

		await request(anna, 'moderator:stopBotJob', { jobId: transcript });
		await request(bot, 'botStatus', { state: 'finished', type: 'recorder' });

		expect(state(room, recording)).toBe('stopping');
		expect(bot.closed).toBe(false);
		expect(stopProviderJob).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(BOT_JOB_TIMERS.leave + 1);
		expect(bot.closed).toBe(true);
		expect(room.botJobs.active).toEqual([]);
	});

	test('sends a new kind to a bot that is away, and shows it as away too', async () => {
		const room = makeRoom([ everything ]);
		const anna = makeHuman(room);

		await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		await flush();

		const botId = botIdOf();
		const bot = makeBot(room, botId);

		await room.botJobs.admit({ botId, credentialId: 9 });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });
		bot.close();

		const streaming = (await request(anna, 'moderator:startBotJob', { type: 'streamer' })).response.jobId as string;

		await flush();

		expect(startProviderJob.mock.calls[1][1].botId).toBe(botId);
		expect(state(room, streaming)).toBe('interrupted');
	});

	test('stops every job of a bot whose breakout room is removed', async () => {
		const room = makeRoom([ everything ]);
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);

		anna.permissions = [ Permission.MODERATE_ROOM, Permission.CREATE_ROOM ];
		anna.sessionId = breakout.sessionId;

		const recording = (await request(anna, 'moderator:startBotJob', { type: 'recorder' })).response.jobId as string;
		const transcript = (await request(anna, 'moderator:startBotJob', { type: 'transcriber' })).response.jobId as string;

		await flush();

		const bot = makeBot(room, botIdOf(), breakout.sessionId);

		await room.botJobs.admit({ botId: botIdOf(), credentialId: 9, sessionId: breakout.sessionId });
		room.joinPeer(bot);
		anna.sessionId = room.sessionId;

		await request(anna, 'removeBreakoutRoom', { roomSessionId: breakout.sessionId });

		expect(stopProviderJob.mock.calls.map(([ , id ]) => id).sort()).toEqual([ recording, transcript ].sort());
		expect(bot.closed).toBe(true);
		expect(room.botJobs.active).toEqual([]);
	});

	test('stops every job of every bot when the room closes', async () => {
		const { room, anna, recording, transcript } = await withBot();

		room.removePeer(anna);

		expect(room.closed).toBe(true);
		expect(stopProviderJob.mock.calls.map(([ , id ]) => id).sort()).toEqual([ recording, transcript ].sort());
	});

	test('offers its kinds to the room', () => {
		const room = makeRoom([ everything ]);

		expect(room.botJobs.providers()).toEqual([ { id: 9, label: 'Acme', jobTypes: [ 'recorder', 'transcriber', 'streamer' ] } ]);
	});
});

describe('a room with bot jobs', () => {
	test('stops them at their providers when it closes', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await flush();
		room.removePeer(anna);

		expect(room.closed).toBe(true);
		expect(stopProviderJob).toHaveBeenCalledWith(recorder, response.jobId);
	});

	test('leaves them running when the room server shuts down', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);

		await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		room.botJobs.close({ keepJobs: true });
		room.removePeer(anna);

		expect(room.closed).toBe(true);
		expect(stopProviderJob).not.toHaveBeenCalled();
	});

	test('sends a participant the jobs again when its connection comes back', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		(anna.notify as jest.Mock).mockClear();
		jest.spyOn(room as unknown as { assignRouter: () => void }, 'assignRouter').mockImplementation(() => undefined);
		room.reconnectPeer(anna);

		expect(lastJobs(anna)).toEqual([ expect.objectContaining({ id: response.jobId }) ]);
	});

	test('says nothing about jobs in a room without providers', () => {
		const room = makeRoom([]);
		const anna = makeHuman(room);

		jest.spyOn(room as unknown as { assignRouter: () => void }, 'assignRouter').mockImplementation(() => undefined);
		room.reconnectPeer(anna);
		anna.sessionId = 'elsewhere';

		expect((anna.notify as jest.Mock).mock.calls.map(([ n ]) => n.method)).not.toContain('botJobs');
	});

	test('shows a participant the jobs of the session it moves to', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);
		const guest = makeHuman(room, false);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		expect(lastJobs(guest)).toHaveLength(1);

		guest.sessionId = breakout.sessionId;
		expect(lastJobs(guest)).toEqual([]);

		guest.sessionId = room.sessionId;
		expect(lastJobs(guest)[0]).toMatchObject({ id: response.jobId });
	});
});

describe('who is told about the recording', () => {
	const owners = [ { id: 1, roomId: 'r', userId: 'u-owner' }, { id: 2, roomId: 'r', userId: 'u-other' } ];
	const started = async (room: Room) => {
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await Promise.resolve();
		await Promise.resolve();

		return { anna, jobId: response.jobId as string, body: startProviderJob.mock.calls[0]?.[1] };
	};

	test('the owners of the room and the one who started it, each once', async () => {
		const room = makeRoom();

		room.owners = owners;
		room.resolveBotRecipients = jest.fn(async (ids) => ids.map((id) => ({ email: `${id}@example.org` })));

		const { anna, body } = await started(room);

		expect(room.resolveBotRecipients).toHaveBeenCalledWith([ 'u-owner', 'u-other', anna.managedId ]);
		expect(body.recipients).toEqual([ { email: 'u-owner@example.org' }, { email: 'u-other@example.org' }, { email: `${anna.managedId}@example.org` } ]);
	});

	test('an owner who starts it is listed once, and two accounts with one address too', async () => {
		const room = makeRoom();

		room.owners = [ { id: 1, roomId: 'r', userId: 'u-0' } ];
		room.resolveBotRecipients = jest.fn(async () => [ { email: 'Teacher@Example.org' }, { email: 'teacher@example.org ' }, { email: '' } ]);

		const { anna, body } = await started(room);

		expect(anna.managedId).toBe('u-0');
		expect(room.resolveBotRecipients).toHaveBeenCalledWith([ 'u-0' ]);
		expect(body.recipients).toEqual([ { email: 'Teacher@Example.org' } ]);
	});

	test('only the one who started it, in a room that has no owners', async () => {
		const room = makeRoom();

		room.resolveBotRecipients = jest.fn(async (ids) => ids.map((id) => ({ email: `${id}@example.org` })));

		const { anna, body } = await started(room);

		expect(room.resolveBotRecipients).toHaveBeenCalledWith([ anna.managedId ]);
		expect(body.recipients).toEqual([ { email: `${anna.managedId}@example.org` } ]);
	});

	test('carries the language of the tenant, and nothing when the tenant has none', async () => {
		const room = makeRoom();

		room.locale = 'pl';
		expect((await started(room)).body.locale).toBe('pl');

		startProviderJob.mockClear();
		expect('locale' in (await started(makeRoom())).body).toBe(false);
	});

	test('does not reach the provider when the job was ended while the addresses were still being looked up', async () => {
		const room = makeRoom();
		// eslint-disable-next-line no-unused-vars
		let answer: (r: { email: string }[]) => void = () => undefined;

		room.owners = owners;
		room.resolveBotRecipients = () => new Promise((resolve) => { answer = resolve; });

		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await request(anna, 'moderator:stopBotJob', { jobId: response.jobId });
		answer([ { email: 'late@example.org' } ]);
		for (let i = 0; i < 20; i++) await Promise.resolve();

		expect(startProviderJob).not.toHaveBeenCalled();
		expect(stopProviderJob).toHaveBeenCalledTimes(1);
	});

	test('still starts the job when the addresses cannot be looked up, or nobody can look them up', async () => {
		const failing = makeRoom();

		failing.owners = owners;
		failing.resolveBotRecipients = jest.fn(async () => { throw new Error('management down'); });

		const first = await started(failing);

		expect(first.body).toBeDefined();
		expect('recipients' in first.body).toBe(false);
		expect(state(failing, first.jobId)).toBe('starting');

		startProviderJob.mockClear();

		const alone = makeRoom();

		alone.owners = owners;

		const second = await started(alone);

		expect(second.body).toBeDefined();
		expect('recipients' in second.body).toBe(false);
	});
});
