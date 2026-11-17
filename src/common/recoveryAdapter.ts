import { SessionAwareAdapter } from 'socket.io-adapter';
import { IOServerConnection } from './IOServerConnection';
import { ByteBudget, Keyed, MAX_RECONNECTS_PER_MINUTE, RateLimiter } from './rateLimiter';
import { limitHit } from './suspiciousClients';

// A client that drops can miss what was sent shortly before: the drop is noticed by the ping
// timeout at the latest, 45 seconds after it happened.
export const REPLAY_WINDOW_MS = 60_000;

type Session = { sid: string; pid: string; rooms: string[]; data: unknown; disconnectedAt: number };
type KeptPacket = {
	id: string;
	opts: { rooms: Set<string>; except: Set<string> };
	data: unknown[];
	emittedAt: number;
	bytes?: number;
};
// What SessionAwareAdapter keeps; private in its type declarations.
type Kept = { sessions: Map<string, Session>; packets: KeptPacket[]; maxDisconnectionDuration: number };

/**
 * What the room server knows of the connection a session belongs to. It lives in socket.data,
 * which socket.io keeps with the session and hands to the socket that recovers it, so it stays
 * with the session however often that drops and comes back.
 */
export type SessionOwner = {
	peerId: string;
	// Of the connection the room server took last.
	address?: string;
	// A restore is a reconnect, and a session gets as many of them in a minute as a peer.
	restores: RateLimiter;
	// The newest stored packet at the last restore: what came before it was handed back then.
	replayedThrough?: string;
};

const OWNER = 'recoveryOwner';

type WithData = { data?: unknown };

const ownerIn = (data: unknown): SessionOwner | undefined => {
	const owner = (data as Record<string, unknown> | undefined)?.[OWNER] as SessionOwner | undefined;

	return typeof owner?.peerId === 'string' && owner.restores instanceof RateLimiter ? owner : undefined;
};

export const sessionOwner = (socket: WithData): SessionOwner | undefined => ownerIn(socket.data);

// The room server takes the connection for this peer. A recovered socket keeps what its session
// has used up; only where it comes from can have changed.
export const ownSession = (socket: WithData, peerId: string, address?: string): void => {
	const owner = sessionOwner(socket);

	if (owner?.peerId === peerId) {
		owner.address = address;

		return;
	}

	// Without it socket.io keeps nothing with the session, and the session is never restored.
	if (!socket.data || typeof socket.data !== 'object') return;

	(socket.data as Record<string, unknown>)[OWNER] = {
		peerId,
		address,
		restores: new RateLimiter(MAX_RECONNECTS_PER_MINUTE, 60_000),
	} satisfies SessionOwner;
};

const forSession = (rooms: string[], { rooms: to, except }: KeptPacket['opts']): boolean =>
	(to.size === 0 || rooms.some((room) => to.has(room))) && rooms.every((room) => !except.has(room));

/**
 * socket.io hands a client that recovers its session everything sent to its socket since an offset
 * the client chooses, written out before the room server sees the connection. A socket that
 * recovered a session keeps the session's id, and leaves the session behind again when it drops,
 * so one client can ask for a replay again and again. What it gets is therefore bounded here,
 * before anything is encoded:
 *
 * - only a session of a connection the room server took is restored;
 * - a session is restored as often in a minute as a peer may reconnect;
 * - a packet is handed back to a session once: a later restore starts after what the one before
 *   covered, whatever offset the client names;
 * - only what was sent from the minute before the drop on is handed back, and only if that fits
 *   what a connection may have waiting;
 * - all sessions of one address together get a budget of bytes.
 *
 * Otherwise the client connects afresh and gets the room state as on any reconnect.
 */
export class RecoveryAdapter extends SessionAwareAdapter {
	// What the sessions of one address may be handed back: two of the largest replays at once,
	// then a megabyte a second. A network that drops for a whole lecture hall is one address;
	// those of its clients that find the budget used up connect afresh.
	public static addressBurstBytes = 64 * 1024 * 1024;
	public static addressBytesPerSecond = 1024 * 1024;

	private readonly addressBudgets = new Keyed(() =>
		new ByteBudget(RecoveryAdapter.addressBurstBytes, RecoveryAdapter.addressBytesPerSecond));

	override restoreSession(pid: string, offset: string): ReturnType<SessionAwareAdapter['restoreSession']> {
		const kept = this as unknown as Kept;
		const session = kept.sessions.get(pid);

		kept.sessions.delete(pid);

		if (!session || session.disconnectedAt + kept.maxDisconnectionDuration < Date.now()) return null as never;

		const owner = ownerIn(session.data);

		if (!owner) return null as never;

		// No client in normal use drops and comes back this often.
		if (!owner.restores.take()) {
			limitHit(owner.address);

			return null as never;
		}

		const { packets } = kept;
		const index = packets.findIndex((packet) => packet.id === offset);

		if (index === -1) return null as never;

		// Packets leave the store oldest first: with this one gone, all that were handed back are.
		const handed = owner.replayedThrough === undefined
			? -1
			: packets.findIndex((packet) => packet.id === owner.replayedThrough);
		const since = session.disconnectedAt - REPLAY_WINDOW_MS;
		const missedPackets: unknown[][] = [];
		let bytes = 0;

		for (let i = Math.max(index, handed) + 1; i < packets.length; i++) {
			const packet = packets[i];

			if (packet.emittedAt < since || !forSession(session.rooms, packet.opts)) continue;

			packet.bytes ??= JSON.stringify(packet.data).length;
			bytes += packet.bytes;

			if (bytes > IOServerConnection.maxUnsentBytes) return null as never;

			missedPackets.push(packet.data);
		}

		// Not a limit hit: the budget is shared by everyone behind the address.
		if (bytes > 0 && !this.addressBudgets.for(owner.address ?? '').take(bytes)) return null as never;

		owner.replayedThrough = packets[packets.length - 1].id;

		return Promise.resolve({ ...session, missedPackets }) as ReturnType<SessionAwareAdapter['restoreSession']>;
	}
}
