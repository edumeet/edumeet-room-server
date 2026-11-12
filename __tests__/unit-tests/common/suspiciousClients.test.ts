import 'jest';

let mockConfig: Record<string, unknown> = {};
const mockAppended: Array<{ file: string; line: string }> = [];
let mockFail = false;

jest.mock('../../../src/Config', () => ({ getConfig: () => mockConfig }));
jest.mock('fs', () => ({
	...jest.requireActual('fs'),
	// eslint-disable-next-line no-unused-vars
	appendFile: (file: string, line: string, done: (error: Error | null) => void) => {
		if (mockFail) return done(new Error('read-only file system'));

		mockAppended.push({ file, line });
		done(null);
	},
}));

import { connectionEnded, limitHit, resetSuspiciousClients, roomStateSent, SUSPICIOUS_CLIENTS_DEFAULTS } from '../../../src/common/suspiciousClients';
import type { Peer } from '../../../src/Peer';

const FILE = '/usr/src/app/suspicious/suspicious-ips.log';
const T0 = Date.parse('2026-11-12T10:00:00.000Z');
const { windowSeconds, maxShortConnections, maxLimitHits } = SUSPICIOUS_CLIENTS_DEFAULTS;

// A connection of a peer that was handed the state of a room, as a join or a reconnect does.
const connectionFrom = (address: string, gotState = true) => {
	const connection = { address: { address } };

	if (gotState) roomStateSent({ connections: { items: [ connection ] } } as unknown as Peer);

	return connection;
};

beforeEach(() => {
	mockConfig = { suspiciousClients: { file: FILE } };
	mockAppended.length = 0;
	mockFail = false;
	resetSuspiciousClients();
});

test('Nothing is written without a file in the config', () => {
	mockConfig = {};

	for (let i = 0; i < 1000; i++) {
		connectionEnded(connectionFrom('203.0.113.7'), 0, T0);
		limitHit('203.0.113.7', T0);
	}

	expect(mockAppended).toEqual([]);
});

test('An address with too many short connections is written once in a window', () => {
	for (let i = 0; i < maxShortConnections; i++) connectionEnded(connectionFrom('203.0.113.7'), 1_000, T0 + i);

	expect(mockAppended).toEqual([]);

	connectionEnded(connectionFrom('203.0.113.7'), 1_000, T0 + 100);

	expect(mockAppended).toEqual([
		{ file: FILE, line: '2026-11-12T10:00:00.100Z 203.0.113.7 short_connections=51 limit_hits=0 window=300s\n' }
	]);

	for (let i = 0; i < 100; i++) connectionEnded(connectionFrom('203.0.113.7'), 1_000, T0 + 200);

	expect(mockAppended).toHaveLength(1);
});

// A bot retries every few seconds while the room it should join is not open yet: refused
// before it got anything, which costs little.
test('Connections that were not handed the state of a room do not count', () => {
	for (let i = 0; i < 1000; i++) connectionEnded(connectionFrom('198.51.100.9', false), 100, T0);

	expect(mockAppended).toEqual([]);
});

test('The count starts again in a new window', () => {
	for (let i = 0; i <= maxShortConnections; i++) connectionEnded(connectionFrom('203.0.113.7'), 1_000, T0);

	const next = T0 + (windowSeconds * 1000);

	for (let i = 0; i < maxShortConnections; i++) connectionEnded(connectionFrom('203.0.113.7'), 1_000, next);

	expect(mockAppended).toHaveLength(1);

	connectionEnded(connectionFrom('203.0.113.7'), 1_000, next);

	expect(mockAppended).toHaveLength(2);
});

// A lecture behind one university address loses its network: every connection ends at once.
test('Connections that lasted a meeting do not count, however many end together', () => {
	for (let i = 0; i < 500; i++) connectionEnded(connectionFrom('198.51.100.1'), 40 * 60_000, T0);

	expect(mockAppended).toEqual([]);
});

test('An address with too many refused requests is written', () => {
	for (let i = 0; i < maxLimitHits; i++) limitHit('203.0.113.9', T0);

	expect(mockAppended).toEqual([]);

	limitHit('203.0.113.9', T0);

	expect(mockAppended.map(({ line }) => line)).toEqual([
		'2026-11-12T10:00:00.000Z 203.0.113.9 short_connections=0 limit_hits=11 window=300s\n'
	]);
});

test('Addresses are counted apart, and one without an address is not counted', () => {
	for (let i = 0; i < maxLimitHits; i++) {
		limitHit('203.0.113.1', T0);
		limitHit('203.0.113.2', T0);
	}
	for (let i = 0; i < 100; i++) limitHit(undefined, T0);

	expect(mockAppended).toEqual([]);
});

test('The window, the length of a short connection and the limits come from the config', () => {
	mockConfig = { suspiciousClients: { file: FILE, windowSeconds: 60, shortConnectionSeconds: 5, maxShortConnections: 2, maxLimitHits: 1 } };

	connectionEnded(connectionFrom('203.0.113.7'), 6_000, T0);
	connectionEnded(connectionFrom('203.0.113.7'), 4_000, T0);
	connectionEnded(connectionFrom('203.0.113.7'), 4_000, T0);

	expect(mockAppended).toEqual([]);

	connectionEnded(connectionFrom('203.0.113.7'), 4_000, T0);

	expect(mockAppended[0].line).toBe('2026-11-12T10:00:00.000Z 203.0.113.7 short_connections=3 limit_hits=0 window=60s\n');
});

test('A file that cannot be written does not stop the server', () => {
	mockFail = true;

	expect(() => {
		for (let i = 0; i <= maxLimitHits; i++) limitHit('203.0.113.7', T0);
	}).not.toThrow();
});
