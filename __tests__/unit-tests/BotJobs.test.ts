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
}));

const startProviderJob = providerClient.startProviderJob as jest.Mock;
const stopProviderJob = providerClient.stopProviderJob as jest.Mock;

const recorder: BotProvider = { credentialId: 7, label: 'Acme Recorder', jobType: 'recorder', apiUrl: 'https://rec.example.com', apiSecret: 'key' };
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

const makeBot = (room: Room, jobId: string, botSessionId?: string): Peer => {
	const peer = new Peer({ id: `b-${created.length}`, sessionId: room.sessionId, reconnectKey: 'k', headless: true, botVerified: true, botType: 'recorder', botSessionId, jobId });

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
const lastJobs = (peer: Peer) => (peer.notify as jest.Mock).mock.calls.map(([ n ]) => n).filter((n) => n.method === 'botJobs')
	.pop()?.data.jobs;

beforeEach(() => {
	jest.useFakeTimers();
	startProviderJob.mockClear();
	startProviderJob.mockImplementation(async () => undefined);
	stopProviderJob.mockClear();
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

		expect(startProviderJob).toHaveBeenCalledTimes(1);

		const [ provider, body ] = startProviderJob.mock.calls[0];

		expect(provider).toBe(recorder);
		expect(body).toMatchObject({ jobId, type: 'recorder', room: { host: 'meet.example.org', roomId: 'lecture 1', sessionId: room.sessionId, mainSessionId: room.sessionId } });

		const url = new URL(body.room.url);

		expect(url.origin + url.pathname).toBe('https://meet.example.org/lecture%201');
		expect(Object.fromEntries(url.searchParams)).toEqual({ headless: '1', botType: 'recorder', jobId, displayName: 'Acme Recorder' });
		expect(state(room, jobId)).toBe('starting');
		expect(lastJobs(anna)).toEqual([ { id: jobId, type: 'recorder', label: 'Acme Recorder', state: 'starting', sessionId: room.sessionId } ]);
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

		for (let i = 0; i < MAX_ACTIVE_BOT_JOBS; i++) await request(anna, 'moderator:startBotJob', { type: 'recorder' });

		await expect(request(anna, 'moderator:startBotJob', { type: 'recorder' })).rejects.toThrow('too many bot jobs');
	});

	test('runs in the breakout room the moderator is in', async () => {
		const room = makeRoom();
		const breakout = new BreakoutRoom({ parent: room, name: 'Group A' });

		room.breakoutRooms.set(breakout.sessionId, breakout);

		const anna = makeHuman(room);

		anna.sessionId = breakout.sessionId;
		await request(anna, 'moderator:startBotJob', { type: 'recorder' });

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
		const bot = makeBot(all.room, all.jobId);

		expect(all.room.botJobs.admit({ jobId: all.jobId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
		all.room.joinPeer(bot);

		return { ...all, bot };
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

	test('cannot speak for a job that is not its own', async () => {
		const { room, jobId } = await joined();
		const stranger = makeBot(room, jobId);

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

	test('drops a job id that did not come from a verified bot', () => {
		const room = makeRoom();
		const generic = new Peer({ id: 'generic', sessionId: room.sessionId, reconnectKey: 'k', headless: true, jobId: '5b2f1c1e-0000-4000-8000-000000000000' });

		created.push(generic);
		expect(generic.jobId).toBeUndefined();
	});
});

describe('stopping a bot job', () => {
	const running = async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });
		const jobId = response.jobId as string;
		const bot = makeBot(room, jobId);

		room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });

		return { room, anna, jobId, bot };
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

		await request(anna, 'moderator:stopBotJob', { jobId });
		expect(state(room, jobId)).toBeUndefined();
		expect(room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true, rejection: 'jobNotActive' });
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
		const bot = makeBot(room, jobId, breakout.sessionId);

		room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder', sessionId: breakout.sessionId });
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
		const bot = makeBot(room, jobId);

		room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' });
		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });

		return { room, anna, jobId, bot };
	};

	test('is interrupted, and runs on when the bot is back in time', async () => {
		const { room, jobId, bot } = await running();

		bot.close();
		expect(state(room, jobId)).toBe('interrupted');

		// the heartbeat is not what fails an interrupted job
		jest.advanceTimersByTime(BOT_JOB_TIMERS.interrupted - 1_000);
		expect(state(room, jobId)).toBe('interrupted');

		const back = makeBot(room, jobId);

		expect(room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
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
		const { room, jobId, bot } = await running();

		expect(room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true, rejection: 'jobNotActive' });

		jest.spyOn(bot, 'connectionLost', 'get').mockReturnValue(true);
		expect(room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
		expect(bot.closed).toBe(true);
		expect(state(room, jobId)).toBe('running');
	});

	test('refuses a bot that holds another provider\'s key, or comes for another session', async () => {
		const { room, jobId } = await running();

		expect(room.botJobs.admit({ jobId, credentialId: 8, botType: 'recorder' })).toEqual({ known: true, rejection: 'botTokenRejected' });
		expect(room.botJobs.admit({ jobId, credentialId: 7, botType: 'recorder', sessionId: 'elsewhere' })).toEqual({ known: true, rejection: 'jobNotActive' });
	});
});

describe('a job the room server does not know', () => {
	const unknown = '5b2f1c1e-0000-4000-8000-000000000000';

	test('is taken over from a verified bot of one of the room\'s providers', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);

		expect(room.botJobs.admit({ jobId: unknown, credentialId: 7, botType: 'recorder' })).toEqual({ known: true });
		expect(state(room, unknown)).toBe('starting');
		expect(startProviderJob).not.toHaveBeenCalled();

		const bot = makeBot(room, unknown);

		room.joinPeer(bot);
		await request(bot, 'botStatus', { state: 'running' });
		expect(lastJobs(anna)[0]).toMatchObject({ id: unknown, state: 'running', label: 'Acme Recorder' });
	});

	test('is no job at all when the key belongs to no provider of the room', () => {
		const room = makeRoom();

		makeHuman(room);
		expect(room.botJobs.admit({ jobId: unknown, credentialId: 99, botType: 'recorder' })).toEqual({ known: false });
		expect(room.botJobs.active).toEqual([]);
	});
});

describe('a room with bot jobs', () => {
	test('stops them at their providers when it closes', async () => {
		const room = makeRoom();
		const anna = makeHuman(room);
		const { response } = await request(anna, 'moderator:startBotJob', { type: 'recorder' });

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
