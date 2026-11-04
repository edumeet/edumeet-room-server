import 'jest';
import { AppConfigSchema } from '../../../src/common/schema';
import { MAX_BOT_JOBS_LIMIT } from '../../../src/BotJobs';

describe('the config key for the bot jobs of a room', () => {
	const field = AppConfigSchema.shape.maxBotJobsPerRoom;

	test('is optional, and a whole number from 1 to the most a room may ever run', () => {
		for (const value of [ undefined, 1, 10, MAX_BOT_JOBS_LIMIT ]) expect(field.safeParse(value).success).toBe(true);
	});

	test('refuses anything else, so a server with a wrong value does not start', () => {
		for (const value of [ 0, -1, MAX_BOT_JOBS_LIMIT + 1, 2.5, '10', null ]) expect(field.safeParse(value).success).toBe(false);
	});
});
