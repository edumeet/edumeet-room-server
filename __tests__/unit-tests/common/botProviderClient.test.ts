import 'jest';
import { startProviderJob, stopProviderJob, BotProviderError, PROVIDER_TIMEOUT_MS } from '../../../src/common/botProviderClient';
import { BotProvider } from '../../../src/common/botProfile';

const provider: BotProvider = { credentialId: 7, label: 'Acme', jobType: 'recorder', apiUrl: 'https://rec.example.com/', apiSecret: 'acme-key' };
const job = { jobId: 'j1', type: 'recorder' as const, room: { url: 'https://meet.example.org/r', host: 'meet.example.org', roomId: 'r', sessionId: 's' } };

const answer = (status: number) => ({ status, body: { cancel: jest.fn(async () => undefined) } });
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
		expect(init.headers).toEqual({ 'Authorization': 'Bearer acme-key', 'Content-Type': 'application/json' });
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
});
