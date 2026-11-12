export const MAX_DISPLAY_NAME_LENGTH = 128;
export const MAX_CHAT_MESSAGE_LENGTH = 10000;
export const MAX_BREAKOUT_ROOM_NAME_LENGTH = 128;
export const MAX_PICTURE_LENGTH = 2048;
export const MAX_MAGNET_URI_LENGTH = 8192;

export const isValidText = (value: unknown, maxLength: number): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;

// JSON writes a control character or half of a surrogate pair as six characters, so they would
// make the history sent to everyone up to six times its size. Text pasted from a document can
// hold page and line breaks (vertical tab, form feed): those become line breaks.
const DOCUMENT_BREAKS = /[\u000B\u000C]/g;
const OTHER_CONTROL_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// The text of a chat message as it is stored and sent, or undefined if there is none.
export const chatText = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || value.length > MAX_CHAT_MESSAGE_LENGTH) return undefined;

	const text = value
		.replace(LONE_SURROGATES, '\uFFFD')
		.replace(DOCUMENT_BREAKS, '\n')
		.replace(OTHER_CONTROL_CHARACTERS, '');

	return isValidText(text, MAX_CHAT_MESSAGE_LENGTH) ? text : undefined;
};

const ALL_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

// A display name as it is stored and sent, or undefined if there is none. It goes into every
// chat message and file entry, so it is cleaned as chat text is; a name has one line, so
// tabs and line breaks become spaces.
export const displayNameText = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || value.length > MAX_DISPLAY_NAME_LENGTH) return undefined;

	const name = value
		.replace(LONE_SURROGATES, '\uFFFD')
		.replace(ALL_CONTROL_CHARACTERS, ' ');

	return isValidText(name, MAX_DISPLAY_NAME_LENGTH) ? name : undefined;
};

// An empty picture means none; the client sends '' when it has no picture.
export const isValidPicture = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_PICTURE_LENGTH;

// A magnet link is printable ASCII: names and addresses in it are percent-encoded.
const MAGNET_CHARACTERS = /^[\x21-\x7E]+$/;

export const isValidMagnetUri = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= MAX_MAGNET_URI_LENGTH &&
	MAGNET_CHARACTERS.test(value) &&
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

// The BitTorrent info-hashes of a magnet link, as lower-case hex. A client finds a torrent
// by its info-hash, which may be written as 40 hex or 32 base32 characters, so two links
// that differ in text can name the same file.
export const magnetInfoHashes = (magnetURI: string): string[] =>
	new URLSearchParams(magnetURI.slice('magnet:?'.length))
		.getAll('xt')
		.filter((xt) => xt.toLowerCase().startsWith('urn:btih:'))
		.map((xt) => normalizeInfoHash(xt.slice('urn:btih:'.length)))
		.filter((hash): hash is string => Boolean(hash));

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

const normalizeInfoHash = (hash: string): string | undefined => {
	const lower = hash.toLowerCase();

	if (/^[0-9a-f]{40}$/.test(lower)) return lower;
	if (!/^[a-z2-7]{32}$/.test(lower)) return undefined;

	let bits = '';

	for (const c of lower) bits += BASE32.indexOf(c).toString(2)
		.padStart(5, '0');

	return bits.match(/.{4}/g)?.map((b) => parseInt(b, 2).toString(16))
		.join('');
};
