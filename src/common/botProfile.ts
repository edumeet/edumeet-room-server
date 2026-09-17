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

export type BotRejection = 'roomNotOpen' | 'botsNotAllowed' | 'botTokenRejected' | 'sessionNotOpen' | 'sessionClosed';

export type BotVerdict =
	| { allowed: true; verified: boolean; label?: string }
	| { allowed: false; reason: BotRejection };

export const botTypes = [ 'recorder', 'transcriber', 'streamer' ] as const;
export type BotType = typeof botTypes[number];

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
	produceData: false,
	middlewares: [ 'media', 'mls' ] as RoomMiddlewareName[],
};
