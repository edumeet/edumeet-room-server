import 'jest';
import { getProviderBotJobs, startProviderJob, stopProviderJob, BotProviderError, PROVIDER_ANSWER_LIMIT, PROVIDER_TIMEOUT_MS } from '../../../src/common/botProviderClient';
import { BotProvider } from '../../../src/common/botProfile';

const provider: BotProvider = { credentialId: 7, label: 'Acme', jobTypes: [ 'recorder' ], apiUrl: 'https://rec.example.com/', apiSecret: 'acme-key' };
const job = { jobId: 'j1', type: 'recorder' as const, botId: 'b1', room: { url: 'https://meet.example.org/r', host: 'meet.example.org', roomId: 'r', sessionId: 's', mainSessionId: 's' } };

const answer = (status: number) => ({ status, body: { cancel: jest.fn(async () => undefined) } });
// An answer with a body that is read in chunks, as fetch hands it over.
const answerWith = (status: number, text: string) => {
	const bytes = new TextEncoder().encode(text);
	let sent = false;

	return {
		status,
		body: {
			cancel: jest.fn(async () => undefined),
			getReader: () => ({
				read: async () => {
					if (sent) return { done: true, value: undefined };
					sent = true;

					return { done: false, value: bytes };
				},
				cancel: jest.fn(async () => undefined),
			}),
		},
	};
};
const fetchMock = jest.fn();

beforeEach(() => {
	fetchMock.mockReset();
	global.fetch = fetchMock as unknown as typeof fetch;
});

describe('calling a bot provider', () => {
	test('posts the job to a fixed path with the key as a bearer token and follows no redirect', async () => {
		fetchMock.mockResolvedValue(answer(202));
		await startProviderJob(provider, job);

		const [ url, init ] = fetchMock.mock.calls[0];

		expect(String(url)).toBe('https://rec.example.com/v1/jobs');
		expect(init).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify(job) });
		expect(Object.fromEntries(init.headers)).toEqual({ 'authorization': 'Bearer acme-key', 'content-type': 'application/json' });
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(PROVIDER_TIMEOUT_MS).toBe(10_000);
	});

	test('never calls a provider that is not https', async () => {
		await expect(startProviderJob({ ...provider, apiUrl: 'http://rec.example.com' }, job)).rejects.toThrow(BotProviderError);
		await expect(stopProviderJob({ ...provider, apiUrl: 'not a url' }, 'j1')).rejects.toThrow(BotProviderError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('takes anything but a 2xx as a refusal, and says nothing of why', async () => {
		fetchMock.mockResolvedValue(answer(500));
		await expect(startProviderJob(provider, job)).rejects.toThrow('provider refused the job');

		fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:443'));
		await expect(startProviderJob(provider, job)).rejects.toThrow('provider request failed');
	});

	test('stops a job with a delete, and takes a job the provider does not know as stopped', async () => {
		fetchMock.mockResolvedValue(answer(404));
		await stopProviderJob(provider, 'a/b');

		const [ url, init ] = fetchMock.mock.calls[0];

		expect(String(url)).toBe('https://rec.example.com/v1/jobs/a%2Fb');
		expect(init.method).toBe('DELETE');
		expect(init.body).toBeUndefined();

		fetchMock.mockResolvedValue(answer(503));
		await expect(stopProviderJob(provider, 'j1')).rejects.toThrow(BotProviderError);
	});

	test('says which failures to stop a job may pass', async () => {
		const retryable = async (): Promise<boolean> => stopProviderJob(provider, 'j1').then(() => {
			throw new Error('stopped');
		}, (err: BotProviderError) => err.retryable);

		for (const status of [ 500, 502, 503, 504, 507, 408, 429 ]) {
			fetchMock.mockResolvedValue(answer(status));
			expect(await retryable()).toBe(true);
		}

		for (const status of [ 400, 401, 403, 405, 409, 422, 501, 505 ]) {
			fetchMock.mockResolvedValue(answer(status));
			expect(await retryable()).toBe(false);
		}

		fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:443'));
		expect(await retryable()).toBe(true);

		fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
		expect(await retryable()).toBe(true);

		await expect(stopProviderJob({ ...provider, apiUrl: 'http://rec.example.com' }, 'j1')).rejects.toMatchObject({ retryable: false });
	});

	test('never sends, nor tells of, a key that cannot go in a header', async () => {
		const secret = 'acme-key\nX-Other: 1';
		const failure = await stopProviderJob({ ...provider, apiSecret: secret }, 'j1').catch((err: Error) => err);

		expect(failure).toMatchObject({ name: 'BotProviderError', message: 'provider key cannot be sent', retryable: false });
		expect(String((failure as Error).message)).not.toContain('acme-key');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('asks which jobs a returning bot runs in this room, and reads only a short, sensible answer', async () => {
		const room = { host: 'meet.example.org', roomId: 'r' };
		const jobId = '6c3a2d2f-0000-4000-8000-00000000000a';

		fetchMock.mockResolvedValue(answerWith(200, JSON.stringify({ jobs: [ { jobId, type: 'recorder' }, { jobId: 'x', type: 'recorder' } ] })));
		expect(await getProviderBotJobs(provider, 'b/1', { host: 'meet.example.org', roomId: 'lecture 1&x' })).toEqual([ { jobId, type: 'recorder' } ]);

		const [ url, init ] = fetchMock.mock.calls[0];

		expect(String(url)).toBe('https://rec.example.com/v1/bots/b%2F1?host=meet.example.org&roomId=lecture+1%26x');
		expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
		expect(Object.fromEntries(init.headers)).toEqual({ 'authorization': 'Bearer acme-key' });

		fetchMock.mockResolvedValue(answer(404));
		expect(await getProviderBotJobs(provider, 'b1', room)).toEqual([]);

		fetchMock.mockResolvedValue(answer(500));
		await expect(getProviderBotJobs(provider, 'b1', room)).rejects.toThrow(BotProviderError);

		fetchMock.mockResolvedValue(answerWith(200, 'not json'));
		await expect(getProviderBotJobs(provider, 'b1', room)).rejects.toThrow('not JSON');

		fetchMock.mockResolvedValue(answerWith(200, 'x'.repeat(PROVIDER_ANSWER_LIMIT + 1)));
		await expect(getProviderBotJobs(provider, 'b1', room)).rejects.toThrow('too large');
	});
});
