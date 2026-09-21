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
	| { allowed: true; verified: boolean; label?: string; credentialId?: number; jobType?: BotType }
	| { allowed: false; reason: BotRejection };

// A tenant's provider of one kind of job, as the management server hands it out.
export interface BotProvider {
	credentialId: number;
	label: string;
	jobType: BotType;
	apiUrl: string;
	apiSecret: string;
}

// What the management server answered, kept only where it is a provider the room
// server can call: anything else is dropped rather than trusted.
export const asBotProviders = (found: unknown): BotProvider[] => {
	const providers: BotProvider[] = [];

	for (const row of Array.isArray(found) ? found as Record<string, unknown>[] : []) {
		const jobType = asBotType(row?.jobType);
		const credentialId = Number(row?.credentialId);

		if (!jobType || !Number.isInteger(credentialId) || credentialId <= 0) continue;
		if (typeof row.apiUrl !== 'string' || !row.apiUrl.startsWith('https://')) continue;
		if (typeof row.apiSecret !== 'string' || !row.apiSecret) continue;

		providers.push({ credentialId, label: typeof row.label === 'string' && row.label ? row.label : 'Bot', jobType, apiUrl: row.apiUrl, apiSecret: row.apiSecret });
	}

	return providers;
};

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const asJobId = (value: unknown): string | undefined =>
	(typeof value === 'string' && JOB_ID.test(value) ? value.toLowerCase() : undefined);

export const asBotType = (value: unknown): BotType | undefined =>
	botTypes.find((type) => type === value);

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
