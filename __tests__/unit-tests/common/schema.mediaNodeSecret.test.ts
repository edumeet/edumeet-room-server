import 'jest';
import { AppConfigSchema } from '../../../src/common/schema';

// A room server that connects without a secret hides a media node that asks for none: both
// keep working, and anyone who reaches the media node can use it.
describe('the secret of a media node in the config', () => {
	const field = AppConfigSchema.shape.mediaNodes;
	const node = (secret?: unknown) => ({
		hostname: 'localhost',
		port: 3000,
		latitude: 63.4,
		longitude: 10.4,
		...(secret === undefined ? {} : { secret })
	});

	test('is accepted when it is set', () => {
		expect(field.safeParse([ node('secret-shared-with-media-node') ]).success).toBe(true);
	});

	// "secret": "${MEDIA_SECRET}" in a template, with the variable not set
	test('is refused when it is empty, so the server does not start', () => {
		const result = field.safeParse([ node('') ]);

		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain('MEDIA_SECRET');
	});

	test('is refused when it is missing or not a string', () => {
		for (const secret of [ undefined, null, 12345, true ]) expect(field.safeParse([ node(secret) ]).success).toBe(false);
	});

	test('is checked for every media node', () => {
		expect(field.safeParse([ node('one'), node('') ]).success).toBe(false);
	});
});
