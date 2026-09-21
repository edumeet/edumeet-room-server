import { Logger } from 'edumeet-common';
import type { BotProvider, BotType } from './botProfile';

const logger = new Logger('botProviderClient');

// Part of the provider contract, see BOT-PROVIDER-API.md.
export const PROVIDER_TIMEOUT_MS = 10_000;

export interface BotJobRequest {
	jobId: string;
	type: BotType;
	room: {
		url: string;
		host: string;
		roomId: string;
		sessionId: string;
		sessionName?: string;
	};
}

export class BotProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BotProviderError';
	}
}

// The url comes from a tenant admin, so the call is kept on a short lead: https
// with normal certificate validation, no redirects to follow, a fixed path, a
// timeout, and a body that is never read. What went wrong is logged here and
// never passed on to the room.
const call = async (provider: BotProvider, method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<number> => {
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

		void response.body?.cancel().catch(() => undefined);

		return response.status;
	} catch (err) {
		logger.warn({ err, credentialId: provider.credentialId, method, host: url.host }, 'call() provider request failed');

		throw new BotProviderError('provider request failed');
	}
};

export const startProviderJob = async (provider: BotProvider, job: BotJobRequest): Promise<void> => {
	const status = await call(provider, 'POST', '/v1/jobs', job);

	if (status < 200 || status > 299) {
		logger.warn({ credentialId: provider.credentialId, status }, 'startProviderJob() provider refused the job');

		throw new BotProviderError('provider refused the job');
	}
};

export const stopProviderJob = async (provider: BotProvider, jobId: string): Promise<void> => {
	const status = await call(provider, 'DELETE', `/v1/jobs/${encodeURIComponent(jobId)}`);

	// A job the provider no longer knows is a job that is stopped.
	if ((status < 200 || status > 299) && status !== 404) {
		logger.warn({ credentialId: provider.credentialId, status }, 'stopProviderJob() provider refused to stop the job');

		throw new BotProviderError('provider refused to stop the job');
	}
};
