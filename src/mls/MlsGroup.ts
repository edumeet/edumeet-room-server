import { Logger } from 'edumeet-common';

const logger = new Logger('MlsGroup');

export const FOUNDER_TIMEOUT_MS = 10_000;
export const JOINER_TIMEOUT_MS = 5_000;
export const WAIT_RETRY_MS = 500;
export const DEPARTURE_COMMIT_MS = 60_000;

export type JoinInfo =
	| { role: 'founder' }
	| { role: 'joiner'; epoch: number; groupInfo: string }
	| { role: 'wait'; retryAfterMs: number };

export type CommitResult = { accepted: boolean; epoch: number };

// The room server's share of an MLS group: it orders commits and hands newcomers the current
// GroupInfo. It never holds a secret and never decodes an MLS message. Everything it stores is
// opaque base64 handed to it by the members, and its one rule is the epoch check, which is what
// makes two members committing at once safe: the first commit built on the current epoch wins,
// the rest are refused and their senders catch up from the winner.
//
// The first peer to ask is told to found the group; until it publishes the initial GroupInfo, or
// disappears, or times out, later peers are told to wait and ask again. Once the group exists,
// joiners are admitted one at a time for the same reason: every external commit is built on the
// current GroupInfo, so two joiners handed the same one would race and all but one would have to
// start over, which in a room where two hundred people arrive together is quadratic work and a
// good chance of giving up. A joiner holds its turn until its commit is accepted, it leaves, or
// it times out.
//
// A commit also needs a reason: it adds the joiner whose turn it is, or removes members who left.
// Those are the only commits the client makes, and without the rule any member could offer
// commits in a loop, each passed on to everyone. Each member that leaves lets one commit through
// within DEPARTURE_COMMIT_MS: one commit may remove several, and members who leave while a
// removal is on its way need a commit of their own.
export class MlsGroup {
	#epoch?: number;
	#groupInfo?: string;
	#founder?: { peerId: string; since: number };
	#joiner?: { peerId: string; since: number };
	#committer?: string;
	// When members left, oldest first; each lets one commit through.
	#departures: number[] = [];
	#keyPackages = new Map<string, string>();

	public get exists(): boolean {
		return this.#groupInfo !== undefined;
	}

	public get epoch(): number | undefined {
		return this.#epoch;
	}

	public get founder(): string | undefined {
		return this.#founder?.peerId;
	}

	#joinerBusy(peerId: string, now: number): boolean {
		return this.#joiner !== undefined && this.#joiner.peerId !== peerId && now - this.#joiner.since < JOINER_TIMEOUT_MS;
	}

	// How long the GroupInfo is that join() would answer this peer with now; 0 when it
	// would answer something else. For the caller to limit how often it is handed out.
	public joinAnswerLength(peerId: string, now = Date.now()): number {
		if (this.#epoch === undefined || this.#groupInfo === undefined || this.#joinerBusy(peerId, now)) return 0;

		return this.#groupInfo.length;
	}

	public join(peerId: string, now = Date.now()): JoinInfo {
		if (this.#epoch !== undefined && this.#groupInfo !== undefined) {
			if (this.#joinerBusy(peerId, now)) return { role: 'wait', retryAfterMs: WAIT_RETRY_MS };

			if (this.#joiner?.peerId !== peerId) this.#joiner = { peerId, since: now };

			return { role: 'joiner', epoch: this.#epoch, groupInfo: this.#groupInfo };
		}

		if (this.#founder && this.#founder.peerId !== peerId && now - this.#founder.since < FOUNDER_TIMEOUT_MS)
			return { role: 'wait', retryAfterMs: WAIT_RETRY_MS };

		if (this.#founder?.peerId !== peerId)
			logger.debug('join() founder chosen [peerId: %s]', peerId);

		this.#founder = { peerId, since: now };

		return { role: 'founder' };
	}

	public publish(peerId: string, epoch: number, groupInfo: string): boolean {
		if (!this.exists) {
			if (this.#founder?.peerId !== peerId || epoch !== 0) return false;

			this.#epoch = epoch;
			this.#groupInfo = groupInfo;
			this.#founder = undefined;
			this.#committer = peerId;

			logger.debug('publish() group founded [peerId: %s, epoch: %s]', peerId, epoch);

			return true;
		}

		// A GroupInfo describes the epoch its committer produced; nobody else gets to restate it.
		if (epoch !== this.#epoch || peerId !== this.#committer) return false;

		this.#groupInfo = groupInfo;

		return true;
	}

	public commit(peerId: string, epoch: number, groupInfo: string, now = Date.now()): CommitResult {
		if (!this.exists || this.#epoch === undefined) return { accepted: false, epoch: -1 };

		if (epoch !== this.#epoch) {
			logger.debug('commit() refused, stale epoch [peerId: %s, epoch: %s, current: %s]', peerId, epoch, this.#epoch);

			return { accepted: false, epoch: this.#epoch };
		}

		const joining = this.#joiner?.peerId === peerId;

		while (this.#departures.length > 0 && now - this.#departures[0] >= DEPARTURE_COMMIT_MS) this.#departures.shift();

		if (!joining && this.#departures.length === 0) {
			logger.debug('commit() refused, no turn to join and nobody left [peerId: %s, epoch: %s]', peerId, epoch);

			return { accepted: false, epoch: this.#epoch };
		}

		this.#epoch = epoch + 1;
		this.#groupInfo = groupInfo;
		this.#committer = peerId;

		if (joining) this.#joiner = undefined;
		else this.#departures.shift();

		return { accepted: true, epoch: this.#epoch };
	}

	public storeKeyPackage(peerId: string, keyPackage: string): void {
		this.#keyPackages.set(peerId, keyPackage);
	}

	public keyPackages(): Record<string, string> {
		return Object.fromEntries(this.#keyPackages);
	}

	public removePeer(peerId: string, now = Date.now()): void {
		this.#keyPackages.delete(peerId);
		this.#departures.push(now);

		if (this.#founder?.peerId === peerId) this.#founder = undefined;
		if (this.#joiner?.peerId === peerId) this.#joiner = undefined;
	}

	public reset(): void {
		this.#epoch = undefined;
		this.#groupInfo = undefined;
		this.#founder = undefined;
		this.#joiner = undefined;
		this.#committer = undefined;
		this.#departures = [];
		this.#keyPackages.clear();
	}
}
