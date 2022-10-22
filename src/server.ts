process.title = 'edumeet-room-server';

import config from '../config/config.json';
import fs from 'fs';
import https from 'https';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { Logger } from './common/logger';
import { SocketIOConnection } from './signaling/SocketIOConnection';
import { interactiveServer } from './interactiveServer';

const logger = new Logger('Server');

(async () => {
	logger.debug('Starting...');

	const serverManager = await ServerManager.create().catch((error) => {
		logger.error('ServerManager creation failed: %o', error);

		return process.exit(1);
	});

	interactiveServer(serverManager);

	const httpsServer = https.createServer({
		cert: fs.readFileSync(config.tls.cert),
		key: fs.readFileSync(config.tls.key),
		minVersion: 'TLSv1.2',
		ciphers: [
			'ECDHE-ECDSA-AES128-GCM-SHA256',
			'ECDHE-RSA-AES128-GCM-SHA256',
			'ECDHE-ECDSA-AES256-GCM-SHA384',
			'ECDHE-RSA-AES256-GCM-SHA384',
			'ECDHE-ECDSA-CHACHA20-POLY1305',
			'ECDHE-RSA-CHACHA20-POLY1305',
			'DHE-RSA-AES128-GCM-SHA256',
			'DHE-RSA-AES256-GCM-SHA384'
		].join(':'),
		honorCipherOrder: true
	});

	httpsServer.listen(config.listenPort, () =>
		logger.debug('httpsServer.listen() [port: %s]', config.listenPort));

	const socketServer = new IOServer(httpsServer, {
		cors: { origin: [ '*' ] },
		cookie: false
	});

	socketServer.on('connection', (socket) => {
		const {
			roomId,
			peerId,
			displayName,
			token,
		} = socket.handshake.query;

		logger.debug(
			'socket connection [socketId: %s, roomId: %s, peerId: %s]',
			socket.id,
			roomId,
			peerId
		);

		if (!roomId || !peerId) {
			logger.warn('socket invalid roomId or peerId');

			return socket.disconnect(true);
		}

		const socketConnection = new SocketIOConnection(socket);

		try {
			serverManager.handleConnection(
				socketConnection,
				peerId as string,
				roomId as string,
				displayName as string,
				token as string,
			);
		} catch (error) {
			logger.warn('handleConnection() [error: %o]', error);

			socketConnection.close();
		}
	});

	const close = () => {
		logger.debug('close()');

		serverManager.close();
		httpsServer.close();

		process.exit(0);
	};

	process.once('SIGINT', close);
	process.once('SIGQUIT', close);
	process.once('SIGTERM', close);

	logger.debug('Started!');
})();