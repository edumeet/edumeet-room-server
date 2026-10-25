import { Logger } from 'edumeet-common';
import { BotProvider } from './botProfile';
import { stopProviderJob } from './botProviderClient';

const logger = new Logger('botProviderStop');

// About 19 minutes in all: long enough for a provider to be redeployed or its database
// to fail over, short enough not to call a provider that is gone for good.
export const STOP_RETRY_DELAYS_MS = [ 10_000, 30_000, 60_000, 120_000, 300_000, 600_000 ];
export const MAX_PENDING_STOPS = 1000;

interface Pending {
	generation: number;
	timer?: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();
let generations = 0;

const retryable = (err: unknown): boolean => (err as { retryable?: unknown } | undefined)?.retryable === true;

// A stop that is lost leaves the provider's bot working, possibly for hours, so one that
// fails for a reason that may pass is sent again. It is kept here, not in the room, so it
// goes on after the room has closed; a restart of this server loses it. The provider
// takes a delete more than once. A newer stop of the same job takes over from an older one.
export const stopProviderJobPersistently = (provider: BotProvider, jobId: string): void => {
	const key = `${provider.credentialId} ${jobId}`;
	const generation = ++generations;
	const previous = pending.get(key);

	clearTimeout(previous?.timer);
	pending.set(key, { generation });

	const attempt = (tries: number): void => {
		stopProviderJob(provider, jobId).then(() => {
			if (pending.get(key)?.generation === generation) pending.delete(key);
		}, (err) => {
			const current = pending.get(key);

			if (current?.generation !== generation) return;

			const delay = STOP_RETRY_DELAYS_MS[tries];

			const reason = !retryable(err) ? 'final' : delay === undefined ? 'exhausted'
				: tries === 0 && pending.size > MAX_PENDING_STOPS ? 'tooMany' : undefined;

			if (reason) {
				pending.delete(key);
				logger.warn({ credentialId: provider.credentialId, jobId, tries: tries + 1, reason }, 'stopProviderJobPersistently() gave up, the provider may still run the job');

				return;
			}

			current.timer = setTimeout(() => attempt(tries + 1), delay);
			current.timer.unref?.();
		});
	};

	attempt(0);
};

export const pendingStops = (): number => pending.size;
