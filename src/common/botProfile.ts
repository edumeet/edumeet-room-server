import type { Permission } from './authorization';

export type RoomMiddlewareName =
	| 'peer'
	| 'lobby'
	| 'moderator'
	| 'media'
	| 'lock'
	| 'mls'
	| 'breakout'
	| 'chat'
	| 'privateChat'
	| 'file'
	| 'countdownTimer'
	| 'drawing';

export type BotRejection = 'roomNotOpen' | 'botsNotAllowed' | 'botTokenRejected' | 'sessionNotOpen' | 'sessionClosed' | 'jobNotActive';

export const botTypes = [ 'recorder', 'transcriber', 'streamer' ] as const;
export type BotType = typeof botTypes[number];

export type BotVerdict =
	| { allowed: true; verified: boolean; label?: string; credentialId?: number; jobTypes?: BotType[] }
	| { allowed: false; reason: BotRejection };

// Somebody the provider tells that a recording exists.
export interface BotRecipient {
	email: string;
}

// The ids a lookup is worth making for: the management server's own are positive
// integers, and asking twice for one is asking once.
export const asRecipientIds = (userIds: string[]): number[] =>
	[ ...new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)) ];

// What a users lookup answered, kept only where there is an address.
export const asBotRecipients = (found: unknown): BotRecipient[] => {
	const rows = Array.isArray(found) ? found : (found as { data?: unknown[] } | undefined)?.data ?? [];
	const recipients: BotRecipient[] = [];

	for (const row of rows as Record<string, unknown>[])
		if (typeof row?.email === 'string' && row.email.trim()) recipients.push({ email: row.email.trim() });

	return recipients;
};

// A tenant's provider, as the management server hands it out: one bot of it does
// every kind of job it offers.
export interface BotProvider {
	credentialId: number;
	label: string;
	jobTypes: BotType[];
	apiUrl: string;
	apiSecret: string;
}

// What the management server answered, kept only where it is a provider the room
// server can call: anything else is dropped rather than trusted.
export const asBotProviders = (found: unknown): BotProvider[] => {
	const providers: BotProvider[] = [];

	for (const row of Array.isArray(found) ? found as Record<string, unknown>[] : []) {
		const jobTypes = asBotTypes(row?.jobTypes);
		const credentialId = Number(row?.credentialId);

		if (jobTypes.length === 0 || !Number.isInteger(credentialId) || credentialId <= 0) continue;
		if (typeof row.apiUrl !== 'string' || !row.apiUrl.startsWith('https://')) continue;
		if (typeof row.apiSecret !== 'string' || !row.apiSecret) continue;

		providers.push({ credentialId, label: typeof row.label === 'string' && row.label ? row.label : 'Bot', jobTypes, apiUrl: row.apiUrl, apiSecret: row.apiSecret });
	}

	return providers;
};

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const asJobId = (value: unknown): string | undefined =>
	(typeof value === 'string' && JOB_ID.test(value) ? value.toLowerCase() : undefined);

// A bot is named by the room server the same way as a job.
export const asBotId = asJobId;

export const asBotType = (value: unknown): BotType | undefined =>
	botTypes.find((type) => type === value);

// The known kinds in a list, each once, in a fixed order; anything else reads as none.
export const asBotTypes = (value: unknown): BotType[] =>
	(Array.isArray(value) ? botTypes.filter((type) => value.includes(type)) : []);

// What a provider answered when asked which jobs a returning bot runs: the jobs it
// names with a proper id and a known kind, and nothing else.
export const asProviderBotJobs = (found: unknown): { jobId: string; type: BotType }[] => {
	const listed = (found as { jobs?: unknown } | null | undefined)?.jobs;
	const jobs: { jobId: string; type: BotType }[] = [];

	if (!Array.isArray(listed)) return jobs;

	for (const entry of listed as Record<string, unknown>[]) {
		const jobId = asJobId(entry?.jobId);
		const type = asBotType(entry?.type);

		if (jobId && type) jobs.push({ jobId, type });
	}

	return jobs;
};

// A headless peer (a recorder, streamer or transcriber page) receives everything a
// participant receives but takes no part in the room: it produces nothing, sends
// nothing, and is left out of the decisions the room takes over its participants.
// The URL parameter that claims it is open to any client, so what a bot may do is
// fixed here and never merged with roles or the first-peer rule. A request for
// anything a bot is not given here is refused as unhandled. A bot whose token the
// tenant's management server verified is trusted infrastructure and skips the lobby.
export const botProfile = {
	permissions: [] as Permission[],
	// The literal rather than the enum member: authorization imports this file,
	// so reading the enum here would run into an import cycle.
	verifiedPermissions: [ 'BYPASS_ROOM_LOCK' as Permission ] as Permission[],
	// Monitoring samples go to the media node only and are never handed to another
	// peer, so a bot may send them: its receiving side is the recording's input.
	dataChannels: [ 'observertc-samples' ] as string[],
	middlewares: [ 'media', 'mls' ] as RoomMiddlewareName[],
};
