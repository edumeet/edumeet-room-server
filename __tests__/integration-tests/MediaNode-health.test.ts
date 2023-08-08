import { IOServerConnection, KDPoint, Logger } from 'edumeet-common';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import MediaNode, { ConnectionStatus } from '../../src/media/MediaNode';
import { AddressInfo, ListenOptions } from 'net';
import { readFileSync } from 'fs';
import path from 'path';
import MediaService from '../../src/MediaService';
import LoadBalancer from '../../src/LoadBalancer';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';
import axios from 'axios';

jest.mock('axios', () => {
	const module = jest.requireActual('axios');
	
	return {
		...module,
		get: async (url: string) => {
			const agent = new https.Agent({  
				rejectUnauthorized: false
			});

			return axios.request(
				{ url: url, httpsAgent: agent }
			);
		}
	};
});

const logger = new Logger('jest');

jest.setTimeout(90000);

const init = async (): Promise<{
	httpsServer: https.Server,
	ioServer: IOServer,
	addressInfo: AddressInfo
}> => {
	const options: ListenOptions = {
		host: 'localhost',
		port: Math.floor((Math.random() * (60000)) + 3000)
	};
	let count = 0;

	const httpsServer = https.createServer({
		cert: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-cert.pem')),
		key: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-key.pem'))
	}, (req, res) => {
		res.writeHead(count === 1 ? 200 : 400, { 'Content-Type': 'text/plain' });
		count++;
		res.end();
	}).listen(options);

	return new Promise((resolve) => {
		httpsServer.on('listening', () => {
			const addressInfo = httpsServer.address() as AddressInfo;
			const ioServer = new IOServer(httpsServer);
		
			resolve({
				httpsServer,
				ioServer,
				addressInfo
			});
		});
	});

};

test('MediaService getRouter() should stop trying on successful candidate', async () => {
	const { httpsServer: httpServer, ioServer, addressInfo } = await init();

	let tries = 0;

	logger.debug(addressInfo);
	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				workers: 2,
				load: 0.1
			}
		});

		serverSocket.on('request', (_, respond) => {
			if (tries === 1) respond({ load: 0.2 });
			tries++;
		});
	});

	const mediaNode1 = new MediaNode({
		id: 'mediaNodeId',
		hostname: addressInfo.address,
		port: addressInfo.port,
		secret: 'secret',
		kdPoint: new KDPoint([ 50, 10 ])
	});
	const spyGetRouterMediaNode1 = jest.spyOn(mediaNode1, 'getRouter');
	const mediaNode2 = new MediaNode({
		id: 'mediaNodeId',
		hostname: addressInfo.address,
		port: addressInfo.port,
		secret: 'secret',
		kdPoint: new KDPoint([ 50, 10 ])
	});
	const spyGetRouterMediaNode2 = jest.spyOn(mediaNode2, 'getRouter');
	const spyGetRouterMediaNode3 = jest.fn();
	const mediaNode3 = {
		getRouter: spyGetRouterMediaNode3 } as unknown as MediaNode;

	const loadBalancer = {
		getCandidates: jest.fn().mockReturnValue([ mediaNode1, mediaNode2, mediaNode3 ])
	} as unknown as LoadBalancer;
	const sut = new MediaService({ loadBalancer });

	const room = new Room({
		id: 'id',
		name: 'name',
		tenantId: 'id',
		mediaService: sut,
	});
	const peer = new Peer({
		id: 'id',
		sessionId: 'id'
	});

	await expect(sut.getRouter(room, peer)).resolves.not.toThrow();
	expect(mediaNode1.connectionStatus).toBe(ConnectionStatus.RETRYING);
	expect(mediaNode2.connectionStatus).toBe(ConnectionStatus.OK);
	expect(spyGetRouterMediaNode1).toHaveBeenCalled();
	expect(spyGetRouterMediaNode2).toHaveBeenCalled();
	expect(spyGetRouterMediaNode3).not.toHaveBeenCalled();

	mediaNode1.close();
	mediaNode2.close();
	ioServer.close();
	httpServer.close();
	sut.close();
});

test('MediaNode should retry connection', async () => {
	const { httpsServer, ioServer, addressInfo } = await init();

	let tries = 0;

	logger.debug(addressInfo);
	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				workers: 2,
				load: 0.1
			}
		});

		serverSocket.on('request', (_, respond) => {
			if (tries === 1) respond({});
			tries++;
		});
	});

	const sut = new MediaNode({
		id: 'mediaNodeId',
		hostname: addressInfo.address,
		port: addressInfo.port,
		secret: 'secret',
		kdPoint: new KDPoint([ 50, 10 ])
	});

	expect(sut.connectionStatus).toBe(ConnectionStatus.OK);
	
	await expect(sut.getRouter(
		{ roomId: 'id',
			appData: {} }
	)).rejects.toThrow();
	
	expect(sut.connectionStatus).toBe(ConnectionStatus.RETRYING);

	const getHealthy = async () => {
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				if (sut.connectionStatus === ConnectionStatus.OK) {
					clearInterval(interval);
					resolve({});
				} 
			}, 25);
		});
	};

	await getHealthy(); // Wait until sut.retryConnection() is successful
	expect(sut.connectionStatus).toBe(ConnectionStatus.OK);
	ioServer.close();
	httpsServer.close();
	sut.close();
});
