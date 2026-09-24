import { randomUUID } from 'crypto';
import { Logger } from 'edumeet-common';
import type Room from './Room';
import type { Peer } from './Peer';
import { Permission } from './common/authorization';
import { asBotType, BotProvider, BotRecipient, BotRejection, BotType } from './common/botProfile';
import { getProviderBotJobs, startProviderJob, stopProviderJob } from './common/botProviderClient';

const logger = new Logger('BotJobs');

// Part of the provider contract, see BOT-PROVIDER-API.md.
export const BOT_JOB_TIMERS = {
	join: 60_000,
	running: 60_000,
	heartbeat: 90_000,
	interrupted: 60_000,
	leave: 30_000,
};

export const MAX_ACTIVE_BOT_JOBS = 10;
const MAX_REMEMBERED = 100;
const MAX_REASON_LENGTH = 200;
const MIN_STATUS_INTERVAL = 1_000;

// What a job shows the room: its bot's state, or `stopping` once the job itself is.
export type BotJobState = 'starting' | 'joined' | 'running' | 'stopping' | 'interrupted';
export type BotStatus = 'running' | 'finished' | 'failed';

type BotState = 'starting' | 'joined' | 'running' | 'interrupted' | 'leaving' | 'ended' | 'failed';
type JobState = 'active' | 'stopping' | 'ended' | 'failed';

export interface BotJobInfo {
	id: string;
	type: BotType;
	label: string;
	// The provider row, as `providers()` names it, so a client can tell which bot a job goes to.
	providerId: number;
	state: BotJobState;
	sessionId: string;
	peerId?: string;
}

interface Bot {
	id: string;
	sessionId: string;
	provider: BotProvider;
	state: BotState;
	jobs: BotJob[];
	peer?: Peer;
	timer?: ReturnType<typeof setTimeout>;
	wasRunning?: boolean;
	lastStatus?: number;
}

interface BotJob {
	id: string;
	type: BotType;
	bot: Bot;
	state: JobState;
}

const botOver = (bot: Bot): boolean => bot.state === 'ended' || bot.state === 'failed';
const jobOver = (job: BotJob): boolean => job.state === 'ended' || job.state === 'failed';
const liveJobs = (bot: Bot): BotJob[] => bot.jobs.filter((job) => job.state === 'active');

// The jobs a room has asked its tenant's providers to run, and the bots that run them.
// A provider sends one bot per session, and that bot does every kind of job the
// provider was asked for there: the room server starts and stops each job at the
// provider, and learns everything else from the bot's own connection: the bot
// joining, the status it reports, and the bot leaving. The bot leaves when its last
// job ends. A finished bot stays known until the room closes, so a bot that turns up
// late is refused rather than taken for a new one.
export default class BotJobs {
	#room: Room;
	#bots = new Map<string, Bot>();
	#jobs = new Map<string, BotJob>();
	#recovering = new Map<string, Promise<unknown>>();

	constructor(room: Room) {
		this.#room = room;
	}

	public get active(): BotJobInfo[] {
		return [ ...this.#jobs.values() ].filter((job) => !jobOver(job)).map((job) => this.#info(job));
	}

	public inSession(sessionId: string): BotJobInfo[] {
		return this.active.filter((job) => job.sessionId === sessionId);
	}

	public providers(): { id: number; label: string; jobTypes: BotType[] }[] {
		return this.#room.botProviders.map(({ credentialId, label, jobTypes }) => ({ id: credentialId, label, jobTypes }));
	}

	// Answers at once and calls the provider behind the answer: a client repeats a
	// request that takes longer than a few seconds, and that would start the job again.
	public start(moderator: Peer, type: BotType, providerId?: number): string {
		const candidates = this.#room.botProviders.filter((p) => p.jobTypes.includes(type));
		const provider = providerId == null ? (candidates.length === 1 ? candidates[0] : undefined) : candidates.find((p) => p.credentialId === providerId);
		const sessionId = moderator.sessionId;

		if (!provider) throw new Error('no such bot provider');
		if (!this.#room.tenantFqdn) throw new Error('room has no host to send a bot to');
		// One of each kind per session: a provider switches a kind on or off for its bot.
		if ([ ...this.#jobs.values() ].some((job) => job.state === 'active' && job.type === type && job.bot.sessionId === sessionId))
			throw new Error('bot job already running');
		if (this.active.length >= MAX_ACTIVE_BOT_JOBS) throw new Error('too many bot jobs');

		// A bot that is leaving finishes on its own; a job that comes after it gets a new bot.
		let bot = [ ...this.#bots.values() ].find((b) => b.sessionId === sessionId && b.provider.credentialId === provider.credentialId && !botOver(b) && b.state !== 'leaving');

		if (!bot) {
			const fresh: Bot = { id: randomUUID(), sessionId, provider, state: 'starting', jobs: [] };

			this.#rememberBot(fresh);
			this.#arm(fresh, BOT_JOB_TIMERS.join, () => this.#failBot(fresh, 'joinTimeout'));
			bot = fresh;
		}

		const job: BotJob = { id: randomUUID(), type, bot, state: 'active' };
		const breakout = this.#room.breakoutRooms.get(sessionId);
		const host = this.#host();
		const { id: botId } = bot;

		// A bot that lives through many jobs keeps only the ones that are not over.
		bot.jobs = bot.jobs.filter((j) => !jobOver(j));
		bot.jobs.push(job);
		this.#rememberJob(job);
		this.#announce(sessionId);

		logger.info('start() [roomId: %s, jobId: %s, botId: %s, type: %s, credentialId: %s]', this.#room.id, job.id, botId, type, provider.credentialId);

		// Looked up in the background so the moderator's request is answered at once. A job
		// ended while the addresses were still being looked up is not started at all.
		this.#recipients(moderator.managedId)
			.then((recipients) => {
				if (job.state !== 'active') return false;

				return startProviderJob(provider, {
					jobId: job.id,
					type,
					botId,
					room: {
						url: this.#botUrl(job.bot, host, Boolean(breakout)),
						host,
						roomId: this.#room.id,
						sessionId,
						// The same for every job of one meeting, breakout rooms included, so the
						// provider can put their recordings into one notice.
						mainSessionId: this.#room.sessionId,
						...(breakout?.name ? { sessionName: breakout.name } : {})
					},
					...(recipients.length > 0 ? { recipients } : {}),
					...(this.#room.locale ? { locale: this.#room.locale } : {})
				}).then(() => true);
			})
			.then((posted) => {
				// Stopped while the provider was still answering: it may not have known the job yet.
				if (posted && job.state !== 'active') this.#tellProvider(job);
			}, () => {
				if (!jobOver(job)) this.#failJob(job, 'providerError');
			});

		return job.id;
	}

	#host(): string {
		return (this.#room.tenantFqdn ?? '').toLowerCase().replace(/\.$/, '');
	}

	// The owners of the room and whoever started the job, each once. Nothing here may
	// stop the job: a recording that nobody is told about beats no recording.
	async #recipients(startedBy?: string): Promise<BotRecipient[]> {
		const ids = new Set(this.#room.owners.map((owner) => String(owner.userId)));

		if (startedBy) ids.add(startedBy);
		if (ids.size === 0 || !this.#room.resolveBotRecipients) return [];

		try {
			const seen = new Set<string>();

			return (await this.#room.resolveBotRecipients([ ...ids ])).filter(({ email }) => {
				const key = email.trim().toLowerCase();

				if (!key || seen.has(key)) return false;
				seen.add(key);

				return true;
			});
		} catch (err) {
			logger.warn({ err, roomId: this.#room.id }, 'recipients() not resolved, the job starts without them');

			return [];
		}
	}

	public stop(jobId: string): void {
		const job = this.#jobs.get(jobId);

		if (!job || jobOver(job)) throw new Error('no such bot job');
		if (job.state === 'stopping') return;

		this.#stopJob(job, true);
	}

	// A session that is closing takes its jobs with it; the caller sends the bots away.
	public stopSession(sessionId: string): void {
		for (const job of [ ...this.#jobs.values() ])
			if (job.bot.sessionId === sessionId && job.state === 'active') this.#stopJob(job, true);
	}

	// The bot was removed by a moderator, which ends every job it runs like a stop does.
	public kicked(peer: Peer): void {
		const bot = this.#botOf(peer);

		if (!bot || botOver(bot) || bot.state === 'leaving') return;

		for (const job of liveJobs(bot)) {
			job.state = 'stopping';
			this.#tellProvider(job);
		}

		this.#leave(bot);
	}

	// Asked when a bot connects with a bot id, before it is let in. `known: false`
	// means the id belongs to no bot here and it comes in as a plain bot.
	public async admit({ botId, credentialId, botType, sessionId }: {
		botId: string;
		credentialId?: number;
		botType?: BotType;
		sessionId?: string;
	}): Promise<{ known: boolean; rejection?: BotRejection }> {
		const pending = this.#recovering.get(botId);

		if (pending) await pending;

		const bot = this.#bots.get(botId);

		if (!bot) return this.#recover({ botId, credentialId, botType, sessionId });

		if (botOver(bot) || bot.state === 'leaving') return { known: true, rejection: 'jobNotActive' };
		if (bot.provider.credentialId !== credentialId) return { known: true, rejection: 'botTokenRejected' };
		if ((sessionId ?? this.#room.sessionId) !== bot.sessionId) return { known: true, rejection: 'jobNotActive' };

		if (bot.peer && !bot.peer.closed) {
			// A second page for a bot that is there is refused; one whose page has dropped
			// its connection is the provider reloading it, and takes over.
			if (!bot.peer.connectionLost) return { known: true, rejection: 'jobNotActive' };

			const old = bot.peer;

			bot.peer = undefined;
			old.close();
		}

		return { known: true };
	}

	// A bot this room server does not know, from a bot the tenant vouches for: the room
	// server was restarted under running jobs, which go on. Only the provider knows
	// which jobs those are, so it is asked, once.
	async #recover({ botId, credentialId, botType, sessionId }: {
		botId: string;
		credentialId?: number;
		botType?: BotType;
		sessionId?: string;
	}): Promise<{ known: boolean; rejection?: BotRejection }> {
		const provider = this.#room.botProviders.find((p) => p.credentialId === credentialId);

		if (!provider || (botType && !provider.jobTypes.includes(botType))) return { known: false };

		const session = sessionId ?? this.#room.sessionId;
		const work = (async (): Promise<{ known: boolean; rejection?: BotRejection }> => {
			let listed: { jobId: string; type: BotType }[] = [];

			try {
				listed = await getProviderBotJobs(provider, botId, { host: this.#host(), roomId: this.#room.id });
			} catch {
				listed = [];
			}

			const taken = new Set([ ...this.#jobs.values() ].filter((job) => job.state === 'active' && job.bot.sessionId === session).map((job) => job.type));
			const jobs: { jobId: string; type: BotType }[] = [];

			for (const entry of listed) {
				if (!provider.jobTypes.includes(entry.type) || taken.has(entry.type) || this.#jobs.has(entry.jobId)) continue;
				if (this.active.length + jobs.length >= MAX_ACTIVE_BOT_JOBS) break;

				taken.add(entry.type);
				jobs.push(entry);
			}

			const bot: Bot = { id: botId, sessionId: session, provider, state: 'starting', jobs: [] };

			this.#rememberBot(bot);

			// Nothing to pick up: the bot is remembered as over, so it is not asked about again.
			if (jobs.length === 0 || this.#room.closed) {
				bot.state = 'ended';
				logger.info('admit() nothing to pick up for a bot [roomId: %s, botId: %s]', this.#room.id, botId);

				return { known: true, rejection: 'jobNotActive' };
			}

			for (const { jobId, type } of jobs) {
				const job: BotJob = { id: jobId, type, bot, state: 'active' };

				bot.jobs.push(job);
				this.#rememberJob(job);
			}

			this.#arm(bot, BOT_JOB_TIMERS.join, () => this.#failBot(bot, 'joinTimeout'));
			this.#announce(session);

			logger.info('admit() recovered a bot [roomId: %s, botId: %s, types: %s]', this.#room.id, botId, jobs.map((job) => job.type).join(','));

			return { known: true };
		})();

		this.#recovering.set(botId, work);

		try {
			return await work;
		} finally {
			this.#recovering.delete(botId);
		}
	}

	public attach(peer: Peer): void {
		const bot = peer.botId ? this.#bots.get(peer.botId) : undefined;

		if (!bot || botOver(bot) || bot.state === 'leaving') return;

		// Two pages let in for the same bot before either had joined: the first one keeps it.
		if (bot.peer && bot.peer !== peer && !bot.peer.closed) {
			peer.notify({ method: 'botRejected', data: { reason: 'jobNotActive' } });
			peer.close();

			return;
		}

		bot.peer = peer;
		peer.once('close', () => this.#detached(bot, peer));

		// A bot that was running stays running across a reconnect or a page reload.
		if (bot.state === 'running' || (bot.state === 'interrupted' && bot.wasRunning)) {
			bot.state = 'running';
			this.#arm(bot, BOT_JOB_TIMERS.running, () => this.#failBot(bot, 'noHeartbeat'));
		} else {
			bot.state = 'joined';
			this.#arm(bot, BOT_JOB_TIMERS.running, () => this.#failBot(bot, 'notRunning'));
		}

		this.#announce(bot.sessionId);
	}

	// `running` is the bot's heartbeat. `finished` and `failed` are about the whole bot,
	// or about the one kind of job named with them.
	public status(peer: Peer, status: unknown, reason?: unknown, type?: unknown): void {
		const bot = this.#botOf(peer);

		if (!bot || botOver(bot) || bot.state === 'leaving') return;

		const now = Date.now();
		const kind = asBotType(type);
		const job = kind ? liveJobs(bot).find((j) => j.type === kind) : undefined;

		// A kind that was named must be one the bot runs: a misspelt one is not the whole bot.
		if (type != null && !job && status !== 'running') return;

		if (status === 'running') {
			if (bot.lastStatus && now - bot.lastStatus < MIN_STATUS_INTERVAL) return;

			bot.lastStatus = now;
			this.#arm(bot, BOT_JOB_TIMERS.heartbeat, () => this.#failBot(bot, 'noHeartbeat'));

			if (bot.state !== 'running') {
				bot.state = 'running';
				this.#announce(bot.sessionId);
			}
		} else if (status === 'finished') {
			// The provider is done by its own account, so there is nothing to tell it.
			if (job) this.#stopJob(job, false);
			else {
				for (const done of liveJobs(bot)) done.state = 'stopping';
				this.#leave(bot);
			}
		} else if (status === 'failed') {
			const text = typeof reason === 'string' && reason ? reason.slice(0, MAX_REASON_LENGTH) : 'failed';

			if (job) this.#failJob(job, text, true);
			else this.#failBot(bot, text, true);
		}
	}

	// A room that closes stops its jobs. A room server that shuts down does not: the
	// bots come back to the restarted server and their jobs go on.
	public close({ keepJobs = false } = {}): void {
		for (const bot of this.#bots.values()) {
			clearTimeout(bot.timer);

			for (const job of bot.jobs) {
				if (jobOver(job)) continue;
				if (!keepJobs && job.state === 'active') this.#tellProvider(job);
				job.state = 'ended';
			}

			if (!botOver(bot)) bot.state = 'ended';
		}
	}

	#botOf(peer: Peer): Bot | undefined {
		const bot = peer.botId ? this.#bots.get(peer.botId) : undefined;

		return bot?.peer === peer ? bot : undefined;
	}

	#info(job: BotJob): BotJobInfo {
		const { bot } = job;
		const state: BotJobState = job.state === 'stopping' || bot.state === 'leaving' ? 'stopping'
			: bot.state === 'ended' || bot.state === 'failed' ? 'stopping'
				: bot.state;

		return {
			id: job.id,
			type: job.type,
			label: bot.provider.label,
			providerId: bot.provider.credentialId,
			state,
			sessionId: bot.sessionId,
			...(bot.peer ? { peerId: bot.peer.id } : {})
		};
	}

	// A bot of a provider that offers transcription only is told so, and takes audio
	// only. A bot that may be asked for other kinds later must take everything.
	#botUrl(bot: Bot, host: string, inBreakout: boolean): string {
		const query = new URLSearchParams({ headless: '1' });

		if (bot.provider.jobTypes.length === 1) query.set('botType', bot.provider.jobTypes[0]);
		query.set('botId', bot.id);
		if (inBreakout) query.set('session', bot.sessionId);
		query.set('displayName', bot.provider.label);

		return `https://${host}/${encodeURIComponent(this.#room.id)}?${query.toString()}`;
	}

	#rememberBot(bot: Bot): void {
		this.#bots.set(bot.id, bot);

		for (const [ id, old ] of this.#bots) {
			if (this.#bots.size <= MAX_REMEMBERED) break;
			if (botOver(old)) this.#bots.delete(id);
		}
	}

	#rememberJob(job: BotJob): void {
		this.#jobs.set(job.id, job);

		for (const [ id, old ] of this.#jobs) {
			if (this.#jobs.size <= MAX_REMEMBERED) break;
			if (jobOver(old)) this.#jobs.delete(id);
		}
	}

	#arm(bot: Bot, ms: number, expired: () => void): void {
		clearTimeout(bot.timer);
		bot.timer = setTimeout(expired, ms);
		bot.timer.unref?.();
	}

	// A job that stops while its bot has other work ends at once and the bot stays; the
	// last one takes the bot with it.
	#stopJob(job: BotJob, tell: boolean): void {
		job.state = 'stopping';
		if (tell) this.#tellProvider(job);

		if (liveJobs(job.bot).length > 0) {
			job.state = 'ended';
			logger.info('end() [roomId: %s, jobId: %s, botId: %s]', this.#room.id, job.id, job.bot.id);
			this.#announce(job.bot.sessionId);
		} else this.#leave(job.bot);
	}

	#leave(bot: Bot): void {
		if (bot.peer && !bot.peer.closed) {
			const peer = bot.peer;

			bot.state = 'leaving';
			this.#arm(bot, BOT_JOB_TIMERS.leave, () => {
				logger.info('stop() bot did not leave, closing it [roomId: %s, botId: %s]', this.#room.id, bot.id);
				peer.notify({ method: 'moderator:kick', data: {} });
				peer.close();
			});
			this.#announce(bot.sessionId);
		} else this.#endBot(bot);
	}

	#detached(bot: Bot, peer: Peer): void {
		if (bot.peer !== peer) return;

		bot.peer = undefined;

		if (botOver(bot) || this.#room.closed) return;
		if (bot.state === 'leaving') return this.#endBot(bot);

		bot.wasRunning = bot.state === 'running';
		bot.state = 'interrupted';
		this.#arm(bot, BOT_JOB_TIMERS.interrupted, () => this.#failBot(bot, 'interrupted'));
		this.#announce(bot.sessionId);
	}

	#endBot(bot: Bot): void {
		clearTimeout(bot.timer);
		bot.state = 'ended';

		for (const job of bot.jobs) if (!jobOver(job)) job.state = 'ended';

		logger.info('end() [roomId: %s, botId: %s]', this.#room.id, bot.id);
		this.#announce(bot.sessionId);
	}

	// One kind of job gave up while the bot may go on with the others. A bot left with
	// nothing to do is sent away.
	#failJob(job: BotJob, reason: string, fromBot = false): void {
		if (jobOver(job)) return;

		const { bot } = job;

		job.state = 'failed';
		logger.info('fail() [roomId: %s, jobId: %s, botId: %s, type: %s, credentialId: %s, reportedByBot: %s, reason: %s]', this.#room.id, job.id, bot.id, job.type, bot.provider.credentialId, fromBot, reason);

		this.#tellProvider(job);
		this.#notifyFailure(job, reason);

		if (liveJobs(bot).length === 0 && !bot.jobs.some((j) => j.state === 'stopping')) this.#dismiss(bot, 'ended');
		else this.#announce(bot.sessionId);
	}

	// The bot itself gave up, or edumeet gave up on it: every job it runs has failed.
	// The moderators are told once, by the provider's name.
	#failBot(bot: Bot, reason: string, fromBot = false): void {
		if (botOver(bot)) return;

		const failed = liveJobs(bot);

		for (const job of bot.jobs) {
			if (jobOver(job)) continue;
			if (job.state === 'active') this.#tellProvider(job);
			job.state = job.state === 'active' ? 'failed' : 'ended';
		}

		logger.info('fail() [roomId: %s, botId: %s, types: %s, credentialId: %s, reportedByBot: %s, reason: %s]', this.#room.id, bot.id, failed.map((job) => job.type).join(','), bot.provider.credentialId, fromBot, reason);

		if (failed.length > 0) this.#notifyFailure(failed[0], reason);

		this.#dismiss(bot, 'failed');
	}

	#dismiss(bot: Bot, state: 'ended' | 'failed'): void {
		clearTimeout(bot.timer);
		bot.state = state;

		if (bot.peer && !bot.peer.closed) {
			const peer = bot.peer;

			bot.peer = undefined;
			peer.notify({ method: 'botRejected', data: { reason: 'jobNotActive' } });
			peer.close();
		}

		this.#announce(bot.sessionId);
	}

	#notifyFailure(job: BotJob, reason: string): void {
		if (this.#room.closed) return;

		this.#room.notifyPeersWithPermission('botJobFailed', { jobId: job.id, type: job.type, label: job.bot.provider.label, sessionId: job.bot.sessionId, reason }, Permission.MODERATE_ROOM);
	}

	#tellProvider(job: BotJob): void {
		stopProviderJob(job.bot.provider, job.id).catch(() => undefined);
	}

	#announce(sessionId: string): void {
		if (this.#room.closed) return;

		const data = { sessionId, jobs: this.inSession(sessionId) };

		for (const peer of this.#room.participants)
			if (peer.sessionId === sessionId) peer.notify({ method: 'botJobs', data });
	}
}
