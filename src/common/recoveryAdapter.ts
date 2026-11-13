import { SessionAwareAdapter } from 'socket.io-adapter';
import { IOServerConnection } from './IOServerConnection';

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

const forSession = (rooms: string[], { rooms: to, except }: KeptPacket['opts']): boolean =>
	(to.size === 0 || rooms.some((room) => to.has(room))) && rooms.every((room) => !except.has(room));

/**
 * socket.io hands a client that recovers its session everything sent to its socket since an offset
 * the client chooses, written out before the room server sees the connection. Here a session is
 * restored once, only from the minute before its drop on, and only if that fits what a connection
 * may have waiting; otherwise the client connects afresh and gets the room state as on any
 * reconnect.
 */
export class RecoveryAdapter extends SessionAwareAdapter {
	override restoreSession(pid: string, offset: string): ReturnType<SessionAwareAdapter['restoreSession']> {
		const kept = this as unknown as Kept;
		const session = kept.sessions.get(pid);

		kept.sessions.delete(pid);

		if (!session || session.disconnectedAt + kept.maxDisconnectionDuration < Date.now()) return null as never;

		const index = kept.packets.findIndex((packet) => packet.id === offset);

		if (index === -1) return null as never;

		const since = session.disconnectedAt - REPLAY_WINDOW_MS;
		const missedPackets: unknown[][] = [];
		let bytes = 0;

		for (const packet of kept.packets.slice(index + 1)) {
			if (packet.emittedAt < since || !forSession(session.rooms, packet.opts)) continue;

			packet.bytes ??= JSON.stringify(packet.data).length;
			bytes += packet.bytes;

			if (bytes > IOServerConnection.maxUnsentBytes) return null as never;

			missedPackets.push(packet.data);
		}

		return Promise.resolve({ ...session, missedPackets }) as ReturnType<SessionAwareAdapter['restoreSession']>;
	}
}
