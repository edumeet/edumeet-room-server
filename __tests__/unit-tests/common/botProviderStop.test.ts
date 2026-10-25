import 'jest';
import { MAX_PENDING_STOPS, pendingStops, STOP_RETRY_DELAYS_MS, stopProviderJobPersistently } from '../../../src/common/botProviderStop';
import { BotProviderError, stopProviderJob as stopOnce } from '../../../src/common/botProviderClient';
import { BotProvider } from '../../../src/common/botProfile';

jest.mock('../../../src/common/botProviderClient', () => ({
	...jest.requireActual('../../../src/common/botProviderClient'),
	stopProviderJob: jest.fn(async () => undefined),
}));

const stopProviderJob = stopOnce as jest.Mock;
const provider: BotProvider = { credentialId: 7, label: 'Acme', jobTypes: [ 'recorder' ], apiUrl: 'https://rec.example.com', apiSecret: 'key' };
const unreachable = (): BotProviderError => new BotProviderError('provider request failed', true);
const refused = (): BotProviderError => new BotProviderError('provider refused to stop the job');
const total = STOP_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

beforeEach(() => {
	jest.useFakeTimers();
	stopProviderJob.mockReset();
	stopProviderJob.mockImplementation(async () => undefined);
});

afterEach(async () => {
	stopProviderJob.mockImplementation(async () => undefined);
	await jest.advanceTimersByTimeAsync(total);
	expect(pendingStops()).toBe(0);
	jest.useRealTimers();
});

describe('telling a provider to stop a job', () => {
	test('calls once when the provider answers', async () => {
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(1);
		expect(stopProviderJob).toHaveBeenCalledWith(provider, 'j1');
	});

	test('calls again after each delay in turn while the provider cannot be reached, then gives up', async () => {
		stopProviderJob.mockRejectedValue(unreachable());
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(0);
		expect(stopProviderJob).toHaveBeenCalledTimes(1);

		for (const [ index, delay ] of STOP_RETRY_DELAYS_MS.entries()) {
			await jest.advanceTimersByTimeAsync(delay - 1);
			expect(stopProviderJob).toHaveBeenCalledTimes(index + 1);
			await jest.advanceTimersByTimeAsync(1);
			expect(stopProviderJob).toHaveBeenCalledTimes(index + 2);
		}

		expect(pendingStops()).toBe(0);
	});

	test('stops calling once the provider answers', async () => {
		stopProviderJob.mockRejectedValueOnce(unreachable()).mockRejectedValueOnce(unreachable());
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[0] + STOP_RETRY_DELAYS_MS[1]);
		expect(stopProviderJob).toHaveBeenCalledTimes(3);
		expect(pendingStops()).toBe(0);

		await jest.advanceTimersByTimeAsync(total);
		expect(stopProviderJob).toHaveBeenCalledTimes(3);
	});

	test('takes a refusal as the answer', async () => {
		stopProviderJob.mockRejectedValueOnce(refused());
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(1);
		expect(pendingStops()).toBe(0);
	});

	test('gives up after the last delay, all at once', async () => {
		stopProviderJob.mockRejectedValue(unreachable());
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(STOP_RETRY_DELAYS_MS.length + 1);
		expect(pendingStops()).toBe(0);

		await jest.advanceTimersByTimeAsync(total);
		expect(stopProviderJob).toHaveBeenCalledTimes(STOP_RETRY_DELAYS_MS.length + 1);
	});

	test('lets a newer stop of the same job take over from one that waits', async () => {
		stopProviderJob.mockRejectedValueOnce(unreachable());
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(0);
		expect(pendingStops()).toBe(1);

		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(2);
	});

	test('lets a newer stop of the same job take over from one that is still being answered', async () => {
		let failOlder: () => void = () => undefined;
		let passNewer: () => void = () => undefined;

		stopProviderJob.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failOlder = () => reject(unreachable()); }));
		stopProviderJob.mockImplementationOnce(() => new Promise<void>((resolve) => { passNewer = resolve; }));
		stopProviderJobPersistently(provider, 'j1');
		stopProviderJobPersistently(provider, 'j1');

		// the older one fails while the newer one is still being answered
		failOlder();
		await jest.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[0]);
		expect(stopProviderJob).toHaveBeenCalledTimes(2);
		expect(pendingStops()).toBe(1);

		passNewer();
		await jest.advanceTimersByTimeAsync(total);
		expect(stopProviderJob).toHaveBeenCalledTimes(2);
		expect(pendingStops()).toBe(0);
	});

	test('sends nothing again for an older stop that fails after a newer one got through', async () => {
		let fail: () => void = () => undefined;

		stopProviderJob.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = () => reject(unreachable()); }));
		stopProviderJobPersistently(provider, 'j1');
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(0);
		expect(pendingStops()).toBe(0);

		fail();
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(2);
		expect(pendingStops()).toBe(0);
	});

	test('leaves alone a newer stop when an older one gets through after it', async () => {
		let pass: () => void = () => undefined;

		stopProviderJob.mockImplementationOnce(() => new Promise<void>((resolve) => { pass = resolve; }));
		stopProviderJob.mockRejectedValueOnce(unreachable());
		stopProviderJobPersistently(provider, 'j1');
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(0);
		pass();
		await jest.advanceTimersByTimeAsync(0);
		expect(pendingStops()).toBe(1);

		await jest.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[0]);
		expect(stopProviderJob).toHaveBeenCalledTimes(3);
		expect(pendingStops()).toBe(0);
	});

	test('sends nothing again for an older stop that is answered after a newer one got through', async () => {
		let pass: () => void = () => undefined;

		stopProviderJob.mockImplementationOnce(() => new Promise<void>((resolve) => { pass = resolve; }));
		stopProviderJobPersistently(provider, 'j1');
		stopProviderJobPersistently(provider, 'j1');
		await jest.advanceTimersByTimeAsync(0);
		pass();
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(2);
		expect(pendingStops()).toBe(0);
	});

	test('keeps the stops of different jobs and providers apart', async () => {
		stopProviderJob.mockRejectedValueOnce(unreachable());
		stopProviderJobPersistently(provider, 'j1');
		stopProviderJobPersistently({ ...provider, credentialId: 8 }, 'j1');
		stopProviderJobPersistently(provider, 'j2');
		await jest.advanceTimersByTimeAsync(total);

		expect(stopProviderJob).toHaveBeenCalledTimes(4);
		expect(stopProviderJob).toHaveBeenLastCalledWith(provider, 'j1');
	});

	test('sends a new stop only once while the most it keeps already wait, and goes on with those', async () => {
		stopProviderJob.mockRejectedValue(unreachable());
		for (let i = 0; i < MAX_PENDING_STOPS; i++) stopProviderJobPersistently(provider, `j${i}`);
		await jest.advanceTimersByTimeAsync(0);
		expect(pendingStops()).toBe(MAX_PENDING_STOPS);

		stopProviderJobPersistently(provider, 'one too many');
		await jest.advanceTimersByTimeAsync(0);
		expect(pendingStops()).toBe(MAX_PENDING_STOPS);
		expect(stopProviderJob).toHaveBeenCalledTimes(MAX_PENDING_STOPS + 1);

		await jest.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[0]);
		expect(stopProviderJob).toHaveBeenCalledTimes((2 * MAX_PENDING_STOPS) + 1);
		expect(stopProviderJob.mock.calls.filter(([ , id ]) => id === 'one too many')).toHaveLength(1);
		expect(pendingStops()).toBe(MAX_PENDING_STOPS);
	});
});
