import { Socket } from 'socket.io';
import { Logger } from 'edumeet-common';
import { IOServerConnection } from './IOServerConnection';
import { normalizeMeetingToken } from './meetingToken';
import { asBotId } from './botProfile';
import { isValidPeerId } from './textValidation';
import { connectionEnded, limitHit, replaySent } from './suspiciousClients';
import { resolveClientIp } from './clientAddress';
import { ownSession, sessionOwner } from './recoveryAdapter';

const logger = new Logger('socketHandler');

const addressOf = (socket: Socket): string | undefined =>
	resolveClientIp({ address: socket.handshake.address, forwardedFor: socket.handshake.headers['x-forwarded-for'] });

// Ends a socket at once, as a network failure does, and forgets the session it leaves behind.
// Answers false where the WebSocket cannot be reached.
const cut = (socket: Socket): boolean => {
	const webSocket = (socket.conn as unknown as { transport?: { socket?: { terminate?: () => void } } })?.transport?.socket;

	if (typeof webSocket?.terminate !== 'function') return false;

	const { pid, nsp } = socket as unknown as { pid?: string; nsp?: { adapter?: { sessions?: Map<string, unknown> } } };
	const forget = () => {
		if (pid) nsp?.adapter?.sessions?.delete(pid);
	};

	// socket.io stores the session of a connected socket when it drops, before this runs.
	socket.once('disconnect', forget);
	forget();
	webSocket.terminate();

	return true;
};

// A socket that recovered a session holds that session's replay already: refused, it is cut, so the
// replay does not wait for a client that does not read, and the session it would leave on its drop
// is forgotten, so the replay cannot be asked for again. No client in normal use recovers a session
// with a handshake the room server refuses, so it counts against the address. Other refused sockets
// are told to leave.
const refuse = (socket: Socket): void => {
	if (!socket.recovered) {
		socket.disconnect(true);

		return;
	}

	limitHit(addressOf(socket));

	if (!cut(socket)) socket.disconnect(true);
};

export const socketHandler = (socket: Socket) => {
	const {
		roomId,
		peerId,
		tenantFqdn,
		displayName,
		token,
		reconnectKey,
		meetingToken,
		headless,
		botType,
		session,
		botId,
	} = socket.handshake.query;
	// The bot token travels in the handshake body, never in the URL.
	const botToken = socket.handshake.auth?.botToken;

	logger.debug(
		'socketHandler() - socket connection [socketId: %s, roomId: %s, peerId: %s, tenantFqdn: %s, reconnectKey: %s]',
		socket.id,
		roomId,
		peerId,
		tenantFqdn,
		reconnectKey
	);

	if (!roomId || !peerId || !reconnectKey) {
		logger.warn('socketHandler() - socket invalid roomId or peerId or reconnectKey');

		return refuse(socket);
	}

	if (!isValidPeerId(peerId)) {
		logger.warn('socketHandler() - socket invalid peerId');

		return refuse(socket);
	}

	let tenantFqdnParsed = '';

	//	1) Prefer explicit client-provided hostname (from query)
	if (typeof tenantFqdn === 'string' && tenantFqdn.length) {
		tenantFqdnParsed = tenantFqdn;
	} else {
		//	2) Reverse-proxy header (can be a comma-separated list)
		const xfHost = socket.handshake.headers['x-forwarded-host'];

		if (typeof xfHost === 'string' && xfHost.length) {
			tenantFqdnParsed = xfHost.split(',')[0].trim().split(':')[0];
		} else {
			//	3) Host header
			const host = socket.handshake.headers.host;

			if (typeof host === 'string' && host.length) {
				tenantFqdnParsed = host.split(':')[0];
			} else {
				//	4) Origin header fallback
				const origin = socket.handshake.headers.origin;

				if (typeof origin === 'string' && origin.length) {
					try {
						tenantFqdnParsed = new URL(origin).hostname;
					} catch {
						logger.warn('socketHandler() - socket error parsing origin');

						return refuse(socket);
					}
				}
			}
		}
	}

	if (!tenantFqdnParsed) {
		logger.warn(
			{ queryClientHostname: socket.handshake.query.tenantFqdn, headers: socket.handshake.headers },
			'socketHandler() - cannot determine clientHost'
		);

		return refuse(socket);
	}

	// What a recovered socket was handed is what the peer of its session missed. It is kept only as
	// that peer: under another peerId it would be a new participant, or someone else's.
	if (socket.recovered && sessionOwner(socket)?.peerId !== peerId) {
		logger.warn('socketHandler() - recovered session of another peer [peerId: %s]', peerId);

		return refuse(socket);
	}

	ownSession(socket, peerId as string, addressOf(socket));

	const socketConnection = new IOServerConnection(socket);
	const connectedAt = Date.now();

	// A replay costs the server as the state of a room does.
	if (socket.recovered) replaySent(socketConnection);

	socket.once('disconnect', () => connectionEnded(socketConnection, Date.now() - connectedAt));
	socketConnection.once('notReading', () => limitHit(resolveClientIp(socketConnection.address)));

	void serverManager.handleConnection(
		socketConnection,
		peerId as string,
		roomId as string,
		tenantFqdnParsed as string,
		reconnectKey as string,
		displayName as string,
		token as string,
		normalizeMeetingToken(meetingToken),
		headless === '1' || headless === 'true',
		typeof botToken === 'string' && botToken ? botToken : undefined,
		typeof botType === 'string' ? botType : undefined,
		typeof session === 'string' && session ? session : undefined,
		asBotId(botId),
	).catch((error) => {
		logger.warn({ err: error }, 'socketHandler() - handleConnection()');

		socketConnection.close();

		// Not left to wait, with its replay, for a client that does not read.
		if (socket.recovered) cut(socket);
	});
};
