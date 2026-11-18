import { appendFile } from 'fs';
import { Logger } from 'edumeet-common';
import { getConfig } from '../Config';
import { ConnectionAddress, resolveClientIp } from './clientAddress';
import { IOServerConnection } from './IOServerConnection';
import type { Peer } from '../Peer';

const logger = new Logger('SuspiciousClients');

export interface SuspiciousClientsConfig {
	file?: string;
	windowSeconds?: number;
	shortConnectionSeconds?: number;
	maxShortConnections?: number;
	maxLimitHits?: number;
}

// High on purpose: a whole university can share one address. A class of hundreds that loses its
// network shortly after it joined reconnects all at once, so a short connection is a short one and
// the limit is above the size of a class.
export const SUSPICIOUS_CLIENTS_DEFAULTS = {
	windowSeconds: 300,
	shortConnectionSeconds: 10,
	maxShortConnections: 200,
	maxLimitHits: 10,
};

const MAX_TRACKED_ADDRESSES = 100_000;
const WRITE_WARNING_INTERVAL_MS = 60_000;

interface Counts {
	windowStart: number;
	shortConnections: number;
	limitHits: number;
	reported: boolean;
}

// In the order their windows started: a new window is a new entry at the end.
const tracked = new Map<string, Counts>();
// The connections that were handed the state of a room: only those cost the room server.
let stateSent = new WeakSet<object>();
let lastWriteWarning = 0;

const settings = () => {
	const configured = getConfig().suspiciousClients;

	if (!configured?.file) return undefined;

	return { ...SUSPICIOUS_CLIENTS_DEFAULTS, ...configured, file: configured.file };
};

const countsFor = (address: string, now: number, windowMs: number): Counts => {
	const current = tracked.get(address);

	if (current && now - current.windowStart < windowMs) return current;

	tracked.delete(address);

	for (const [ key, counts ] of tracked) {
		if (now - counts.windowStart < windowMs) break;

		tracked.delete(key);
	}

	if (tracked.size >= MAX_TRACKED_ADDRESSES) tracked.delete(tracked.keys().next().value as string);

	const fresh = { windowStart: now, shortConnections: 0, limitHits: 0, reported: false };

	tracked.set(address, fresh);

	return fresh;
};

const write = (file: string, line: string): void => {
	appendFile(file, line, (error) => {
		if (!error) return;

		const now = Date.now();

		if (now - lastWriteWarning < WRITE_WARNING_INTERVAL_MS) return;

		lastWriteWarning = now;
		logger.warn({ err: error }, 'cannot write the suspicious clients file %s', file);
	});
};

const record = (address: string | undefined, kind: 'shortConnection' | 'limitHit', now: number): void => {
	const active = settings();

	if (!active || !address) return;

	const counts = countsFor(address, now, active.windowSeconds * 1000);

	if (kind === 'shortConnection') counts.shortConnections++;
	else counts.limitHits++;

	if (counts.reported) return;
	if (counts.shortConnections <= active.maxShortConnections && counts.limitHits <= active.maxLimitHits) return;

	counts.reported = true;

	write(active.file, `${new Date(now).toISOString()} ${address} short_connections=${counts.shortConnections} limit_hits=${counts.limitHits} window=${active.windowSeconds}s\n`);
};

export const roomStateSent = (peer: Peer): void => {
	for (const connection of peer.connections.items) stateSent.add(connection);
};

/**
 * A connection has ended. It counts for its address when it was handed the state of a room
 * and lasted less than `shortConnectionSeconds`: people stay for a meeting, a network failure
 * ends long connections, and one that was refused before it got anything cost little.
 */
export const connectionEnded = (connection: { address: ConnectionAddress }, durationMs: number, now = Date.now()): void => {
	const active = settings();

	if (!active || durationMs >= active.shortConnectionSeconds * 1000 || !stateSent.has(connection)) return;

	record(resolveClientIp(connection.address), 'shortConnection', now);
};

// A peer ran into one of its limits per minute, which a client in normal use never does.
export const limitHit = (address: string | undefined, now = Date.now()): void =>
	record(address, 'limitHit', now);

export const addressOf = (peer: Peer): string | undefined => {
	const connection = peer.connections.items.find((item) => item instanceof IOServerConnection) as IOServerConnection | undefined;

	return connection ? resolveClientIp(connection.address) : undefined;
};

export const resetSuspiciousClients = (): void => {
	tracked.clear();
	stateSent = new WeakSet<object>();
	lastWriteWarning = 0;
};
