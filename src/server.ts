process.title = 'edumeet-room-server';

import config from '../config/config.json';
import fs from 'fs';
import https from 'https';
import http from 'http';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { interactiveServer } from './interactiveServer';
import { Logger, KDTree, KDPoint } from 'edumeet-common';
import MediaService from './MediaService';
import { socketHandler } from './common/socketHandler';
import LoadBalancer from './LoadBalancer';
import { Config } from './Config';
import { Peer } from './Peer';
import Room from './Room';
import ManagementService from './ManagementService';

const actualConfig = config as Config;

const logger = new Logger('Server');

const peers = new Map<string, Peer>();
const rooms = new Map<string, Room>();

(async () => {
	logger.debug('Starting...');

	const defaultClientPosition = new KDPoint(
		[ actualConfig.mediaNodes[0].latitude,
			actualConfig.mediaNodes[0].longitude ]
	);
	const kdTree = new KDTree([]);
	const loadBalancer = new LoadBalancer({ kdTree, defaultClientPosition });
	const mediaService = MediaService.create(loadBalancer, kdTree, actualConfig);
	const managementService = await ManagementService.create({ peers, rooms });
	const serverManager = new ServerManager({ peers, rooms, mediaService, managementService });
	
	interactiveServer(serverManager, managementService);
	
	let webServer: http.Server | https.Server;
	
	if (actualConfig.tls?.cert && actualConfig.tls?.key) {
		webServer = https.createServer({
			cert: fs.readFileSync(actualConfig.tls.cert),
			key: fs.readFileSync(actualConfig.tls.key),
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
	
	webServer.listen({ port: actualConfig.listenPort, host: actualConfig.listenHost }, () =>
		logger.debug('webServer.listen() [port: %s]', actualConfig.listenPort));
	
	const socketServer = new IOServer(webServer, {
		cors: { origin: '*' },
		cookie: false
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
})();