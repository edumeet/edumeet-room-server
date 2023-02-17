process.title = 'edumeet-room-server';

import config from '../config/config.json';
import fs from 'fs';
import https from 'https';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { interactiveServer } from './interactiveServer';
import { Logger } from 'edumeet-common';
import MediaService from './MediaService';
import { socketHandler } from './common/socketHandler';
import { LoadBalancer } from './loadbalance/LoadBalancer';
import { LBStrategyFactory } from './loadbalance/LBStrategyFactory';

const logger = new Logger('Server');

logger.debug('Starting...');

const lbStrategyFactory = new LBStrategyFactory(config.loadBalancingStrategies);
const loadBalancer = new LoadBalancer(lbStrategyFactory);

const mediaService = new MediaService(loadBalancer);
const serverManager = new ServerManager({ mediaService });

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

httpsServer.listen({ port: config.listenPort, host: config.listenHost }, () =>
	logger.debug('httpsServer.listen() [port: %s]', config.listenPort));

const socketServer = new IOServer(httpsServer, {
	cors: { origin: '*' },
	cookie: false
});

socketServer.on('connection', socketHandler);

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