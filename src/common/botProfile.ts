import { Permission } from './authorization';

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

// A headless peer (a recorder, streamer or transcriber page) receives everything a
// participant receives but takes no part in the room: it produces nothing, sends
// nothing, and is left out of the decisions the room takes over its participants.
// The URL parameter that claims it is open to any client, so what a bot may do is
// fixed here and never merged with roles or the first-peer rule. A request for
// anything a bot is not given here is refused as unhandled.
export const botProfile = {
	permissions: [] as Permission[],
	produceData: false,
	middlewares: [ 'media', 'mls' ] as RoomMiddlewareName[],
};
