process.title = 'edumeet-room-server';

import fs from 'fs';
import https from 'https';
import http from 'http';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { interactiveServer } from './interactiveServer';
import { Logger, KDPoint } from 'edumeet-common';
import MediaService from './MediaService';
import { socketHandler } from './common/socketHandler';
import LoadBalancer from './LoadBalancer';
import { Peer } from './Peer';
import Room from './Room';
import ManagementService from './ManagementService';
import { getConfig } from './Config';

const logger = new Logger('Server');
const config = getConfig();

if (!config.mediaNodes) throw new Error('No media nodes configured');

const peers = new Map<string, Peer>();
const rooms = new Map<string, Room>();
const managedPeers = new Map<string, Peer>();
const managedRooms = new Map<string, Room>();

logger.debug('Starting...');

const defaultClientPosition = new KDPoint([ config.mediaNodes[0].latitude, config.mediaNodes[0].longitude ]);
const loadBalancer = new LoadBalancer({ defaultClientPosition });
const mediaService = MediaService.create(loadBalancer);

let managementService: ManagementService | undefined;

if (config.managementService)
	managementService = new ManagementService({ managedPeers, managedRooms, mediaService });

const serverManager = new ServerManager({ peers, rooms, managedRooms, managedPeers, mediaService, managementService });

interactiveServer(serverManager, managementService);

let webServer: http.Server | https.Server;

if (config.tls?.cert && config.tls?.key) {
	webServer = https.createServer({
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
} else {
	logger.debug('No TLS certificate or key provided, using HTTP');

	webServer = http.createServer();
}

webServer.listen({ port: config.listenPort, host: config.listenHost }, () =>
	logger.debug('webServer.listen() [port: %s]', config.listenPort));

const socketServer = new IOServer(webServer, {
	cors: { origin: '*' },
	cookie: false,
	connectionStateRecovery: {
		// the backup duration of the sessions and the packets
		maxDisconnectionDuration: 5 * 60 * 1000,
		// whether to skip middlewares upon successful recovery
		skipMiddlewares: true,
	}
});

socketServer.on('connection', socketHandler);

const close = () => {
	logger.debug('close()');

	serverManager.close();
	webServer.close();

	process.exit(0);
};

process.once('SIGINT', close);
process.once('SIGQUIT', close);
process.once('SIGTERM', close);

logger.debug('Started!');
