export const MAX_DISPLAY_NAME_LENGTH = 128;
export const MAX_CHAT_MESSAGE_LENGTH = 10000;
export const MAX_BREAKOUT_ROOM_NAME_LENGTH = 128;
export const MAX_PICTURE_LENGTH = 2048;
export const MAX_MAGNET_URI_LENGTH = 8192;

export const isValidText = (value: unknown, maxLength: number): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;

// An empty picture means none; the client sends '' when it has no picture.
export const isValidPicture = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_PICTURE_LENGTH;

export const isValidMagnetUri = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= MAX_MAGNET_URI_LENGTH &&
	value.startsWith('magnet:?') &&
	new URLSearchParams(value.slice('magnet:?'.length))
		.getAll('xt')
		.some((xt) => xt.startsWith('urn:btih:'));

// Peer ids become object keys in every client's state, so a name that Object.prototype
// already has (__proto__, constructor, toString, ...) would reach the prototype there.
export const isValidPeerId = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) && !(value in Object.prototype);

// Clients look a reaction up in an object of icons, so only the names they offer may pass.
export const REACTIONS: readonly string[] = [ 'thumbup', 'clap', 'party', 'laugh' ];

export const isValidReaction = (value: unknown): value is string | null =>
	value === null || (typeof value === 'string' && REACTIONS.includes(value));
