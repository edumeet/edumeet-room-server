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

	test('TLS validation settings are kept, and a wrong type is refused', () => {
		const parsed = mediaNodes.parse([ mediaNode({ ca: '/certs/node-ca.pem', rejectUnauthorized: true }) ]);

		expect(parsed[0].ca).toBe('/certs/node-ca.pem');
		expect(parsed[0].rejectUnauthorized).toBe(true);
		expect(() => mediaNodes.parse([ mediaNode({ rejectUnauthorized: 'true' }) ])).toThrow();
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

// The default role is given to every participant of an unmanaged room except the first,
// who is made moderator on its own, so it must not carry moderation or room-control rights
describe('shipped default role', () => {
	const participantPermissions = [
		'SEND_CHAT', 'SHARE_AUDIO', 'SHARE_VIDEO', 'SHARE_SCREEN', 'SHARE_EXTRA_VIDEO', 'SHARE_FILE', 'CHANGE_ROOM'
	];
	const names = (role?: { permissions: { name: string }[] }) => (role?.permissions ?? []).map((p) => p.name).sort();
	const saved = process.env.CONFIG_FILE;

	afterEach(() => {
		if (saved === undefined) delete process.env.CONFIG_FILE;
		else process.env.CONFIG_FILE = saved;
	});

	test('the built-in fallback, used without a config file, grants participant permissions only', async () => {
		process.env.CONFIG_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-config-')), 'missing.json');

		await jest.isolateModulesAsync(async () => {
			const { getConfig } = await import('../../../src/Config');

			expect(names(getConfig().defaultRoomSettings?.defaultRole)).toEqual([ ...participantPermissions ].sort());
		});
	});

	test('config.example.json grants participant permissions only', () => {
		const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/config.example.json'), 'utf8'));

		expect(names(example.defaultRoomSettings.defaultRole)).toEqual([ ...participantPermissions ].sort());
	});
});
