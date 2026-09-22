import { randomUUID } from 'crypto';
import { Logger } from 'edumeet-common';
import type Room from './Room';
import type { Peer } from './Peer';
import { Permission } from './common/authorization';
import { BotProvider, BotRecipient, BotRejection, BotType } from './common/botProfile';
import { startProviderJob, stopProviderJob } from './common/botProviderClient';

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
const MAX_REMEMBERED_JOBS = 100;
const MAX_REASON_LENGTH = 200;
const MIN_STATUS_INTERVAL = 1_000;

export type BotJobState = 'starting' | 'joined' | 'running' | 'stopping' | 'interrupted' | 'ended' | 'failed';
export type BotStatus = 'running' | 'finished' | 'failed';

export interface BotJobInfo {
	id: string;
	type: BotType;
	label: string;
	state: BotJobState;
	sessionId: string;
	peerId?: string;
}

interface BotJob {
	id: string;
	type: BotType;
	sessionId: string;
	provider: BotProvider;
	state: BotJobState;
	peer?: Peer;
	timer?: ReturnType<typeof setTimeout>;
	wasRunning?: boolean;
	lastStatus?: number;
}

const over = (state: BotJobState): boolean => state === 'ended' || state === 'failed';

// The jobs a room has asked its tenant's providers to run. The room server calls a
// provider twice in the life of a job, to start it and to stop it; everything in
// between it learns from the bot's own connection: the bot joining, the status it
// reports, and the bot leaving. A finished job stays known until the room closes,
// so a bot that turns up late for it is refused rather than taken for a new one.
export default class BotJobs {
	#room: Room;
	#jobs = new Map<string, BotJob>();

	constructor(room: Room) {
		this.#room = room;
	}

	public get active(): BotJobInfo[] {
		return [ ...this.#jobs.values() ].filter((job) => !over(job.state)).map((job) => this.#info(job));
	}

	public inSession(sessionId: string): BotJobInfo[] {
		return this.active.filter((job) => job.sessionId === sessionId);
	}

	public providers(): { id: number; label: string; jobType: BotType }[] {
		return this.#room.botProviders.map(({ credentialId, label, jobType }) => ({ id: credentialId, label, jobType }));
	}

	// Answers at once and calls the provider behind the answer: a client repeats a
	// request that takes longer than a few seconds, and that would start the job again.
	public start(moderator: Peer, type: BotType, providerId?: number): string {
		const candidates = this.#room.botProviders.filter((p) => p.jobType === type);
		const provider = providerId == null ? (candidates.length === 1 ? candidates[0] : undefined) : candidates.find((p) => p.credentialId === providerId);

		if (!provider) throw new Error('no such bot provider');
		if (!this.#room.tenantFqdn) throw new Error('room has no host to send a bot to');
		if (this.active.length >= MAX_ACTIVE_BOT_JOBS) throw new Error('too many bot jobs');

		const job: BotJob = { id: randomUUID(), type, sessionId: moderator.sessionId, provider, state: 'starting' };
		const breakout = this.#room.breakoutRooms.get(job.sessionId);

		this.#remember(job);
		this.#arm(job, BOT_JOB_TIMERS.join, () => this.#fail(job, 'joinTimeout'));
		this.#announce(job.sessionId);

		logger.info('start() [roomId: %s, jobId: %s, type: %s, credentialId: %s]', this.#room.id, job.id, type, provider.credentialId);

		const host = this.#host();

		// Looked up in the background so the moderator's request is answered at once. A job
		// ended while the addresses were still being looked up is not started at all.
		this.#recipients(moderator.managedId)
			.then((recipients) => {
				if (over(job.state)) return false;

				return startProviderJob(provider, {
					jobId: job.id,
					type,
					room: {
						url: this.#botUrl(job, host, Boolean(breakout)),
						host,
						roomId: this.#room.id,
						sessionId: job.sessionId,
						...(breakout?.name ? { sessionName: breakout.name } : {})
					},
					...(recipients.length > 0 ? { recipients } : {}),
					...(this.#room.locale ? { locale: this.#room.locale } : {})
				}).then(() => true);
			})
			.then((posted) => {
				// Stopped while the provider was still answering: it may not have known the job yet.
				if (posted && (over(job.state) || job.state === 'stopping')) this.#tellProvider(job);
			}, () => {
				if (!over(job.state)) this.#fail(job, 'providerError');
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

		if (!job || over(job.state)) throw new Error('no such bot job');
		if (job.state === 'stopping') return;

		this.#stopping(job);
	}

	// A session that is closing takes its jobs with it; the caller sends the bots away.
	public stopSession(sessionId: string): void {
		for (const job of this.#jobs.values())
			if (job.sessionId === sessionId && !over(job.state) && job.state !== 'stopping') this.#stopping(job);
	}

	// The bot was removed by a moderator, which ends its job like a stop does.
	public kicked(peer: Peer): void {
		const job = this.#of(peer);

		if (job && !over(job.state) && job.state !== 'stopping') this.#stopping(job);
	}

	// Asked when a bot connects with a job id, before it is let in. `known: false`
	// means the id belongs to no job here and the bot comes in as a plain bot.
	public admit({ jobId, credentialId, botType, sessionId }: {
		jobId: string;
		credentialId?: number;
		botType?: BotType;
		sessionId?: string;
	}): { known: boolean; rejection?: BotRejection } {
		let job = this.#jobs.get(jobId);

		if (!job) {
			// A job this room server does not know, from a bot the tenant vouches for:
			// the room server was restarted under a running job, which goes on.
			const provider = this.#room.botProviders.find((p) => p.credentialId === credentialId);

			if (!provider || (botType && botType !== provider.jobType)) return { known: false };
			if (this.active.length >= MAX_ACTIVE_BOT_JOBS) return { known: true, rejection: 'jobNotActive' };

			job = { id: jobId, type: provider.jobType, sessionId: sessionId ?? this.#room.sessionId, provider, state: 'starting' };
			this.#remember(job);
			this.#arm(job, BOT_JOB_TIMERS.join, () => job && this.#fail(job, 'joinTimeout'));
			this.#announce(job.sessionId);

			logger.info('admit() recovered a job [roomId: %s, jobId: %s, type: %s]', this.#room.id, jobId, job.type);

			return { known: true };
		}

		if (over(job.state) || job.state === 'stopping') return { known: true, rejection: 'jobNotActive' };
		if (job.provider.credentialId !== credentialId) return { known: true, rejection: 'botTokenRejected' };
		if ((sessionId ?? this.#room.sessionId) !== job.sessionId) return { known: true, rejection: 'jobNotActive' };

		if (job.peer && !job.peer.closed) {
			// A second page for a job whose bot is there is refused; one whose bot has
			// dropped its connection is the recorder reloading its page, and takes over.
			if (!job.peer.connectionLost) return { known: true, rejection: 'jobNotActive' };

			const old = job.peer;

			job.peer = undefined;
			old.close();
		}

		return { known: true };
	}

	public attach(peer: Peer): void {
		const job = peer.jobId ? this.#jobs.get(peer.jobId) : undefined;

		if (!job || over(job.state) || job.state === 'stopping') return;

		// Two pages let in for the same job before either had joined: the first one keeps it.
		if (job.peer && job.peer !== peer && !job.peer.closed) {
			peer.notify({ method: 'botRejected', data: { reason: 'jobNotActive' } });
			peer.close();

			return;
		}

		job.peer = peer;
		peer.once('close', () => this.#detached(job, peer));

		// A job that was running stays running across a reconnect or a page reload.
		if (job.state === 'running' || (job.state === 'interrupted' && job.wasRunning)) {
			job.state = 'running';
			this.#arm(job, BOT_JOB_TIMERS.running, () => this.#fail(job, 'noHeartbeat'));
		} else {
			job.state = 'joined';
			this.#arm(job, BOT_JOB_TIMERS.running, () => this.#fail(job, 'notRunning'));
		}

		this.#announce(job.sessionId);
	}

	public status(peer: Peer, status: unknown, reason?: unknown): void {
		const job = this.#of(peer);

		if (!job || over(job.state) || job.state === 'stopping') return;

		const now = Date.now();

		if (status === 'running') {
			if (job.lastStatus && now - job.lastStatus < MIN_STATUS_INTERVAL) return;

			job.lastStatus = now;
			this.#arm(job, BOT_JOB_TIMERS.heartbeat, () => this.#fail(job, 'noHeartbeat'));

			if (job.state !== 'running') {
				job.state = 'running';
				this.#announce(job.sessionId);
			}
		} else if (status === 'finished') {
			// The provider is done by its own account, so there is nothing to tell it.
			job.state = 'stopping';
			this.#awaitLeave(job);
		} else if (status === 'failed') {
			this.#fail(job, typeof reason === 'string' && reason ? reason.slice(0, MAX_REASON_LENGTH) : 'failed', true);
		}
	}

	// A room that closes stops its jobs. A room server that shuts down does not: the
	// bots come back to the restarted server and their jobs go on.
	public close({ keepJobs = false } = {}): void {
		for (const job of this.#jobs.values()) {
			clearTimeout(job.timer);

			if (!over(job.state)) {
				if (!keepJobs && job.state !== 'stopping') this.#tellProvider(job);
				job.state = 'ended';
			}
		}
	}

	#of(peer: Peer): BotJob | undefined {
		const job = peer.jobId ? this.#jobs.get(peer.jobId) : undefined;

		return job?.peer === peer ? job : undefined;
	}

	#info(job: BotJob): BotJobInfo {
		return {
			id: job.id,
			type: job.type,
			label: job.provider.label,
			state: job.state,
			sessionId: job.sessionId,
			...(job.peer ? { peerId: job.peer.id } : {})
		};
	}

	#botUrl(job: BotJob, host: string, inBreakout: boolean): string {
		const query = new URLSearchParams({ headless: '1', botType: job.type, jobId: job.id });

		if (inBreakout) query.set('session', job.sessionId);
		query.set('displayName', job.provider.label);

		return `https://${host}/${encodeURIComponent(this.#room.id)}?${query.toString()}`;
	}

	#remember(job: BotJob): void {
		this.#jobs.set(job.id, job);

		for (const [ id, old ] of this.#jobs) {
			if (this.#jobs.size <= MAX_REMEMBERED_JOBS) break;
			if (over(old.state)) this.#jobs.delete(id);
		}
	}

	#arm(job: BotJob, ms: number, expired: () => void): void {
		clearTimeout(job.timer);
		job.timer = setTimeout(expired, ms);
		job.timer.unref?.();
	}

	#stopping(job: BotJob): void {
		job.state = 'stopping';
		this.#tellProvider(job);
		this.#awaitLeave(job);
	}

	#awaitLeave(job: BotJob): void {
		if (job.peer && !job.peer.closed) {
			const peer = job.peer;

			this.#arm(job, BOT_JOB_TIMERS.leave, () => {
				logger.info('stop() bot did not leave, closing it [roomId: %s, jobId: %s]', this.#room.id, job.id);
				peer.notify({ method: 'moderator:kick', data: {} });
				peer.close();
			});
			this.#announce(job.sessionId);
		} else this.#end(job);
	}

	#detached(job: BotJob, peer: Peer): void {
		if (job.peer !== peer) return;

		job.peer = undefined;

		if (over(job.state) || this.#room.closed) return;
		if (job.state === 'stopping') return this.#end(job);

		job.wasRunning = job.state === 'running';
		job.state = 'interrupted';
		this.#arm(job, BOT_JOB_TIMERS.interrupted, () => this.#fail(job, 'interrupted'));
		this.#announce(job.sessionId);
	}

	#end(job: BotJob): void {
		clearTimeout(job.timer);
		job.state = 'ended';
		logger.info('end() [roomId: %s, jobId: %s]', this.#room.id, job.id);
		this.#announce(job.sessionId);
	}

	// A reason the bot gave is the provider's own text, capped by the caller. It is
	// logged, marked as such, because the log is where an operator looks for why a
	// recording died; the room server's own reasons are fixed words.
	#fail(job: BotJob, reason: string, fromBot = false): void {
		if (over(job.state)) return;

		clearTimeout(job.timer);
		job.state = 'failed';
		logger.info('fail() [roomId: %s, jobId: %s, type: %s, credentialId: %s, reportedByBot: %s, reason: %s]', this.#room.id, job.id, job.type, job.provider.credentialId, fromBot, reason);

		this.#tellProvider(job);

		if (job.peer && !job.peer.closed) {
			const peer = job.peer;

			job.peer = undefined;
			peer.notify({ method: 'botRejected', data: { reason: 'jobNotActive' } });
			peer.close();
		}

		if (this.#room.closed) return;

		this.#room.notifyPeersWithPermission('botJobFailed', { jobId: job.id, type: job.type, label: job.provider.label, sessionId: job.sessionId, reason }, Permission.MODERATE_ROOM);
		this.#announce(job.sessionId);
	}

	#tellProvider(job: BotJob): void {
		stopProviderJob(job.provider, job.id).catch(() => undefined);
	}

	#announce(sessionId: string): void {
		if (this.#room.closed) return;

		const data = { sessionId, jobs: this.inSession(sessionId) };

		for (const peer of this.#room.participants)
			if (peer.sessionId === sessionId) peer.notify({ method: 'botJobs', data });
	}
}
