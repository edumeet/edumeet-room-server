import 'jest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppConfigSchema } from '../../../src/common/schema';
import { getIceServers } from '../../../src/common/turnCredentials';

const mediaNode = (over: Record<string, unknown> = {}) => ({
	hostname: 'localhost', port: 3000, secret: 's', latitude: 63.4, longitude: 10.4, ...over
});

describe('media nodes without TURN', () => {
	const mediaNodes = AppConfigSchema.shape.mediaNodes;

	test('turnHostname and turnports may be left out; turnports defaults to an empty list', () => {
		const parsed = mediaNodes.parse([ mediaNode() ]);

		expect(parsed[0].turnHostname).toBeUndefined();
		expect(parsed[0].turnports).toEqual([]);
	});

	test('a configured TURN server is still accepted', () => {
		const turnports = [ { protocol: 'turn', port: 3478, transport: 'udp' } ];

		expect(mediaNodes.parse([ mediaNode({ turnHostname: 'turn.example.org', turnports }) ])[0].turnports).toEqual(turnports);
	});
});

describe('getIceServers', () => {
	const credentials = { username: 'u', credential: 'c' };

	test('sends no ICE server when no TURN host is configured', () => {
		expect(getIceServers({ hostname: '', turnports: [ { protocol: 'turn', port: 3478, transport: 'udp' } ], ...credentials })).toEqual([]);
	});

	test('sends no ICE server with an empty urls list when no TURN ports are configured', () => {
		expect(getIceServers({ hostname: 'turn.example.org', turnports: [], ...credentials })).toEqual([]);
	});

	test('builds one ICE server with a URL per TURN port', () => {
		const servers = getIceServers({
			hostname: 'turn.example.org',
			turnports: [ { protocol: 'turn', port: 3478, transport: 'udp' }, { protocol: 'turns', port: 443, transport: 'tcp' } ],
			...credentials
		});

		expect(servers).toEqual([ {
			urls: [ 'turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:443?transport=tcp' ],
			...credentials
		} ]);
	});
});

describe('CONFIG_FILE', () => {
	const saved = process.env.CONFIG_FILE;

	afterEach(() => {
		if (saved === undefined) delete process.env.CONFIG_FILE;
		else process.env.CONFIG_FILE = saved;
	});

	// getConfig() caches the config per module instance, so load a fresh copy of the module
	test('getConfig() reads the file CONFIG_FILE points to (listen port, TLS, media nodes)', async () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-config-')), 'other.json');

		fs.writeFileSync(file, JSON.stringify({ listenHost: '127.0.0.1', listenPort: '18443', mediaNodes: [ mediaNode() ] }));
		process.env.CONFIG_FILE = file;

		await jest.isolateModulesAsync(async () => {
			const { getConfig, configFilePath } = await import('../../../src/Config');

			expect(configFilePath()).toBe(file);
			expect(getConfig().listenPort).toBe('18443');
		});
	});

	test('defaults to ./config/config.json', async () => {
		delete process.env.CONFIG_FILE;

		await jest.isolateModulesAsync(async () => {
			const { configFilePath } = await import('../../../src/Config');

			expect(configFilePath()).toBe('./config/config.json');
		});
	});
});
