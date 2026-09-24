import { Logger } from 'edumeet-common';
import { asProviderBotJobs, BotProvider, BotRecipient, BotType } from './botProfile';

const logger = new Logger('botProviderClient');

// Part of the provider contract, see BOT-PROVIDER-API.md.
export const PROVIDER_TIMEOUT_MS = 10_000;
// The one answer the room server reads is a short list of jobs.
export const PROVIDER_ANSWER_LIMIT = 64 * 1024;

export interface BotJobRequest {
	jobId: string;
	type: BotType;
	botId: string;
	room: {
		url: string;
		host: string;
		roomId: string;
		sessionId: string;
		mainSessionId: string;
		sessionName?: string;
	};
	recipients?: BotRecipient[];
	locale?: string;
}

export class BotProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BotProviderError';
	}
}

const readCapped = async (response: Response): Promise<string> => {
	const reader = response.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;

	if (!reader) return '';

	for (;;) {
		const { done, value } = await reader.read();

		if (done) break;

		size += value.length;

		if (size > PROVIDER_ANSWER_LIMIT) {
			await reader.cancel().catch(() => undefined);

			throw new BotProviderError('provider answer too large');
		}

		chunks.push(value);
	}

	return Buffer.concat(chunks).toString('utf8');
};

// The url comes from a tenant admin, so the call is kept on a short lead: https
// with normal certificate validation, no redirects to follow, a fixed path, a
// timeout, and a body that is read only where the contract has an answer, and
// then only up to a limit. What went wrong is logged here and never passed on to
// the room.
const call = async (provider: BotProvider, method: 'POST' | 'DELETE' | 'GET', path: string, body?: unknown, read = false): Promise<{ status: number; text?: string }> => {
	let url: URL;

	try {
		url = new URL(`${provider.apiUrl.replace(/\/+$/, '')}${path}`);
	} catch {
		throw new BotProviderError('provider url is not valid');
	}

	if (url.protocol !== 'https:') throw new BotProviderError('provider url is not https');

	try {
		const response = await fetch(url, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
			headers: {
				'Authorization': `Bearer ${provider.apiSecret}`,
				...(body ? { 'Content-Type': 'application/json' } : {})
			},
			body: body ? JSON.stringify(body) : undefined
		});

		if (read && response.status >= 200 && response.status <= 299)
			return { status: response.status, text: await readCapped(response) };

		void response.body?.cancel().catch(() => undefined);

		return { status: response.status };
	} catch (err) {
		if (err instanceof BotProviderError) throw err;

		logger.warn({ err, credentialId: provider.credentialId, method, host: url.host }, 'call() provider request failed');

		throw new BotProviderError('provider request failed');
	}
};

export const startProviderJob = async (provider: BotProvider, job: BotJobRequest): Promise<void> => {
	const { status } = await call(provider, 'POST', '/v1/jobs', job);

	if (status < 200 || status > 299) {
		logger.warn({ credentialId: provider.credentialId, status }, 'startProviderJob() provider refused the job');

		throw new BotProviderError('provider refused the job');
	}
};

export const stopProviderJob = async (provider: BotProvider, jobId: string): Promise<void> => {
	const { status } = await call(provider, 'DELETE', `/v1/jobs/${encodeURIComponent(jobId)}`);

	// A job the provider no longer knows is a job that is stopped.
	if ((status < 200 || status > 299) && status !== 404) {
		logger.warn({ credentialId: provider.credentialId, status }, 'stopProviderJob() provider refused to stop the job');

		throw new BotProviderError('provider refused to stop the job');
	}
};

// Asked once when a bot returns that this room server does not know, after a restart:
// which jobs the bot runs. A bot the provider does not know runs none. The room goes
// with the question: a bot sent into this room with another room's id must not bring
// that room's jobs here, where ending them would stop them there.
export const getProviderBotJobs = async (provider: BotProvider, botId: string, room: { host: string; roomId: string }): Promise<{ jobId: string; type: BotType }[]> => {
	const query = new URLSearchParams({ host: room.host, roomId: room.roomId });
	const { status, text } = await call(provider, 'GET', `/v1/bots/${encodeURIComponent(botId)}?${query.toString()}`, undefined, true);

	if (status === 404) return [];

	if (status < 200 || status > 299) {
		logger.warn({ credentialId: provider.credentialId, status }, 'getProviderBotJobs() provider did not say which jobs the bot runs');

		throw new BotProviderError('provider did not list the jobs');
	}

	try {
		return asProviderBotJobs(JSON.parse(text ?? ''));
	} catch {
		logger.warn({ credentialId: provider.credentialId }, 'getProviderBotJobs() provider answer is not JSON');

		throw new BotProviderError('provider answer is not JSON');
	}
};
