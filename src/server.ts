process.title = 'edumeet-room-server';

import config from '../config/config.json';
import fs from 'fs';
import https from 'https';
import http from 'http';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { interactiveServer } from './interactiveServer';
import { Logger } from 'edumeet-common';
import MediaService from './MediaService';
import { socketHandler } from './common/socketHandler';
import { LoadBalancer } from './loadbalance/LoadBalancer';
import { LBStrategyFactory } from './loadbalance/LBStrategyFactory';

interface Config {
	listenHost: string;
	listenPort: string;
	tls?: {
		cert: string;
		key: string;
	};
	mediaNodes?: Array<{
		hostname: string;
		port: number;
		secret: string;
		latitude: number;
		longitude: number;
	}>;
}

const actualConfig = config as Config;

const logger = new Logger('Server');

logger.debug('Starting...');

const lbStrategyFactory = new LBStrategyFactory(config.loadBalancingStrategies);
const loadBalancer = new LoadBalancer(lbStrategyFactory);

const mediaService = new MediaService(loadBalancer);
const serverManager = new ServerManager({ mediaService });

interactiveServer(serverManager);

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