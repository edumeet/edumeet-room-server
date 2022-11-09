import 'jest';
import MediaService from '../../src/MediaService';

describe('MediaService', () => {
	let mediaService: MediaService;

	beforeEach(() => {
		mediaService = new MediaService();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('Has correct properties', () => {
		expect(mediaService.closed).toBe(false);
	});

	it('close()', () => {
		mediaService.close();
		expect(mediaService.closed).toBe(true);
		expect(mediaService.mediaNodes.length).toBe(0);
	});
});