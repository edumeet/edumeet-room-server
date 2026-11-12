/**
 * At most `max` of something within each window. For what one participant may ask of the
 * server again and again at a cost far above that of asking.
 */
export class RateLimiter {
	#count = 0;
	#windowStart = 0;
	readonly #max: number;
	readonly #windowMs: number;

	constructor(max: number, windowMs: number) {
		this.#max = max;
		this.#windowMs = windowMs;
	}

	// Counts one, or answers false when the window is full.
	public take(now = Date.now()): boolean {
		if (now - this.#windowStart >= this.#windowMs) {
			this.#windowStart = now;
			this.#count = 0;
		}

		if (this.#count >= this.#max) return false;

		this.#count++;

		return true;
	}
}

// A client waits a second or more before it connects again, and a moderator moves a
// participant by hand; both are far below these.
export const MAX_RECONNECTS_PER_MINUTE = 20;
export const MAX_SESSION_CHANGES_PER_MINUTE = 20;
// A client asks once when it joins the group and again when it fell behind.
export const MAX_MLS_JOINS_PER_MINUTE = 20;
export const MAX_MLS_KEY_PACKAGE_REQUESTS_PER_MINUTE = 20;
export const MAX_MLS_PROPOSALS_PER_MINUTE = 20;
// No person sends more than one chat message every two seconds.
export const MAX_CHAT_MESSAGES_PER_MINUTE = 30;

/**
 * Bytes within a budget that refills: up to `capacity` at once, `perSecond` after that. For what
 * one participant sends that is passed on to everyone.
 */
export class ByteBudget {
	#available: number;
	#last = 0;
	readonly #capacity: number;
	readonly #perSecond: number;

	constructor(capacity: number, perSecond: number) {
		this.#capacity = capacity;
		this.#perSecond = perSecond;
		this.#available = capacity;
	}

	// Takes the bytes, or answers false when that many are not there.
	public take(bytes: number, now = Date.now()): boolean {
		this.#available = Math.min(this.#capacity, this.#available + (Math.max(0, now - this.#last) / 1000 * this.#perSecond));
		this.#last = now;

		if (bytes > this.#available) return false;

		this.#available -= bytes;

		return true;
	}
}

// Erasing is what sends the most: every stroke sends each object it touches again. Twenty
// strokes over a block of handwriting send 14 MB in 70 s, twelve fast ones 7 MB in 14 s.
export const WHITEBOARD_BURST_BYTES = 10_000_000;
export const WHITEBOARD_BYTES_PER_SECOND = 20_000_000 / 60;

/**
 * Lets one through at most every `intervalMs`, and the larger it is the less often. For what
 * replaces the one before, where only the latest matters.
 */
export class Throttle {
	#lastAt = Number.NEGATIVE_INFINITY;
	#waitMs = 0;
	readonly #intervalMs: number;
	readonly #bytesPerMs: number;

	constructor(intervalMs: number, bytesPerSecond: number) {
		this.#intervalMs = intervalMs;
		this.#bytesPerMs = bytesPerSecond / 1000;
	}

	public pass(bytes: number, now = Date.now()): boolean {
		// A clock set back lets the next one through.
		if (now >= this.#lastAt && now - this.#lastAt < this.#waitMs) return false;

		this.#lastAt = now;
		this.#waitMs = Math.max(this.#intervalMs, bytes / this.#bytesPerMs);

		return true;
	}
}

// The client sends a dragged object on every pointer move, sixty times a second or more.
export const WHITEBOARD_MOVE_INTERVAL_MS = 50;
export const WHITEBOARD_MOVE_BYTES_PER_SECOND = 2_000_000;
