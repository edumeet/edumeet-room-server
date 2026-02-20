import { Socket } from 'socket.io';
import { Logger } from 'edumeet-common';
import { IOServerConnection } from './IOServerConnection';

const logger = new Logger('socketHandler');

export const socketHandler = (socket: Socket) => {
	const {
		roomId,
		peerId,
		tenantFqdn,
		displayName,
		token,
	} = socket.handshake.query;

	logger.debug(
		'socketHandler() - socket connection [socketId: %s, roomId: %s, peerId: %s, tenantFqdn: %s]',
		socket.id,
		roomId,
		peerId,
		tenantFqdn
	);

	if (!roomId || !peerId) {
		logger.warn('socketHandler() - socket invalid roomId or peerId');

		return socket.disconnect(true);
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

						return socket.disconnect(true);
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

		return socket.disconnect(true);
	}

	const socketConnection = new IOServerConnection(socket);

	void serverManager.handleConnection(
		socketConnection,
		peerId as string,
		roomId as string,
		tenantFqdnParsed as string,
		displayName as string,
		token as string,
	).catch((error) => {
		logger.warn({ err: error }, 'socketHandler() - handleConnection()');

		socketConnection.close();
	});
};
