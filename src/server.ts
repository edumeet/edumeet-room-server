process.title = 'edumeet-room-server';

import fs from 'fs';
import https from 'https';
import http from 'http';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { interactiveServer } from './interactiveServer';
import { Logger } from 'edumeet-common';
import MediaService from './MediaService';
import { socketHandler } from './common/socketHandler';
import { Peer } from './Peer';
import Room from './Room';
import ManagementService from './ManagementService';
import { getConfig } from './Config';
import CustomMetricsService from './MetricsService';

const logger = new Logger('Server');
const config = getConfig();

const peers = new Map<string, Peer>();
const rooms = new Map<string, Room>();
const managedPeers = new Map<string, Peer>();
const managedRooms = new Map<string, Room>();

logger.debug('Starting... [config: %o]', config);

const mediaService = MediaService.create();

let managementService: ManagementService | undefined;

if (config.managementService)
	managementService = new ManagementService({ managedPeers, managedRooms, mediaService });

const serverManager = new ServerManager({ peers, rooms, managedRooms, managedPeers, mediaService, managementService });

interactiveServer(serverManager, managementService);

import { ConfigLoader } from './common/configLoader';
import chokidar from 'chokidar';

// TODO handle no file error
const configFile = process.env.CONFIG_FILE || './config/config.json';
const loader = new ConfigLoader(configFile, 150);
const watcher = chokidar.watch(configFile, { ignoreInitial: true });

let customMetricsService: CustomMetricsService | undefined = undefined;

loader.loadOnce();
// initial load
if (loader.config) {
	logger.debug('Initial config: %o', loader.config);
	if (loader.config.liveReload===true) {
		watcher.on('all', (event) => {
			logger.debug(`Detected config file event: ${event}, scheduling reload`);
			loader.scheduleReload();
		});
		// react to reloads
		loader.on('reloaded', async (newConfig) => {
			logger.debug('Config reloaded:', newConfig);
			if (newConfig.prometheus?.enabled === true && customMetricsService == undefined) {
				customMetricsService = new CustomMetricsService(serverManager, newConfig);
			}
			customMetricsService?.createServer(newConfig);
		});
		loader.on('unchanged', async () => {
			logger.debug('Config unchanged');
		
		});
	
		loader.on('error', (err) => {
			logger.error('Config load error (keeping previous if exists):', err.message || err);
		});
	} else if (loader.config.prometheus?.enabled === true) {
		customMetricsService = new CustomMetricsService(serverManager, loader.config);
	}
}

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
	customMetricsService?.close();
	watcher.close();
	process.exit(0);
};

process.once('SIGINT', close);
process.once('SIGQUIT', close);
process.once('SIGTERM', close);

logger.debug('Started!');
