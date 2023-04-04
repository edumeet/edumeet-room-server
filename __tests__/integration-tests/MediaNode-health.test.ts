import { IOClientConnection, IOServerConnection, KDPoint, Logger, SocketMessage } from 'edumeet-common';
import { MediaNodeConnection } from '../../src/media/MediaNodeConnection';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import MediaNode from '../../src/media/MediaNode';
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
		get: async (url: string, options: { timeout: number}) => {
			const agent = new https.Agent({  
				rejectUnauthorized: false
			});

			return axios.request(
				{ url: url, httpsAgent: agent, timeout: options.timeout }
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
		port: Math.floor((Math.random() * (63000 - 3000)) + 3000)
	};
	let count = 0;

	const httpsServer = https.createServer({
		cert: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-cert.pem')),
		key: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-key.pem'))
	}, (req, res) => {
		res.writeHead(count === 2 ? 200 : 400, { 'Content-Type': 'text/plain' });
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

test('MediaNodeConnection getRouter() should throw on timeout', async () => {
	const { httpsServer, ioServer, addressInfo } = await init();

	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				load: 0
			}
		});
		serverSocket.on('request', async () => {
			// Generate timeout
		});
	});

	const clientSocket = IOClientConnection.create({ url: `wss://${addressInfo.address}:${addressInfo.port}`, retries: 2, timeout: 250 });
	const sut = new MediaNodeConnection({ connection: clientSocket });

	await sut.ready;

	await expect(sut.request({
		method: 'getRouter'
	})).rejects.toThrow();

	if (!clientSocket.closed) {
		clientSocket.close();
	}
	ioServer.close();
	httpsServer.close();
	sut.close();
});

test('MediaNodeConnection should change media node health on error during incoming request', async () => {
	let serverSocket: IOServerConnection | undefined;
	const { httpsServer, ioServer, addressInfo } = await init();

	ioServer.on('connection', (socket) => {
		serverSocket = new IOServerConnection(socket);
		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				load: 0
			}
		});
	});
	const clientSocket = IOClientConnection.create({ url: `wss://${addressInfo.address}:${addressInfo.port}`, retries: 2, timeout: 250 });
	const sut = new MediaNodeConnection({ connection: clientSocket });
	const spy = jest.spyOn(sut, 'emit');

	await sut.ready;
	sut.pipeline.use(() => {
		throw Error('Some error');
	});

	const msg = { data: {} } as unknown as SocketMessage;

	await expect(serverSocket?.request(msg)).rejects.not.toThrow();

	expect(spy.mock.calls[0][0]).toBe('connectionError');
	
	sut.close();
	if (!clientSocket.closed) {
		clientSocket.close();
	}
	ioServer.close();
	httpsServer.close();
});

test('MediaNode should update media-node health on event from media-node-connection', async () => {
	const { httpsServer: httpServer, ioServer, addressInfo } = await init();

	logger.debug(addressInfo);
	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				workers: 2
			}
		});

		serverSocket.on('request', (request, respond) => {
			logger.debug(request);
			respond({ id: 'id' });
		});
	});

	const sut = new MediaNode({
		id: 'mediaNodeId',
		hostname: addressInfo.address,
		port: addressInfo.port,
		secret: 'secret',
		kdPoint: new KDPoint([ 50, 10 ])
	});

	expect(sut.health.status).toBe(true);
	expect(sut.health.updatedAt).toBeUndefined();

	const roomId = 'id';
	const appData = {};

	await sut.getRouter({ roomId, appData });
	
	expect(sut.connection).not.toBeUndefined();
	sut.connection?.emit('connectionError');

	expect(sut.health.status).toBe(false);

	sut.close();
	ioServer.close();
	httpServer.close();
});

test('MediaService getRouter() should try all candidates', async () => {
	const { httpsServer: httpServer, ioServer, addressInfo } = await init();

	logger.debug(addressInfo);
	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				workers: 2
			}
		});

		serverSocket.on('request', () => {
			// Generate timeout
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

	const loadBalancer = {
		getCandidates: jest.fn().mockReturnValue([ mediaNode1, mediaNode2 ])
	} as unknown as LoadBalancer;
	const sut = new MediaService({ loadBalancer });

	const room = new Room({
		id: 'id',
		name: 'name',
		mediaService: sut,
	});
	const peer = new Peer({
		id: 'id',
		roomId: 'id'
	});

	await expect(sut.getRouter(room, peer)).rejects.toThrowError('no media nodes available');
	expect(mediaNode1.health.status).toBe(false);
	expect(mediaNode2.health.status).toBe(false);
	expect(spyGetRouterMediaNode1).toHaveBeenCalled();
	expect(spyGetRouterMediaNode2).toHaveBeenCalled();

	mediaNode1.close();
	mediaNode2.close();
	ioServer.close();
	httpServer.close();
	sut.close();
});

test('MediaService getRouter() should stop trying on successful candidate', async () => {
	const { httpsServer: httpServer, ioServer, addressInfo } = await init();

	let tries = 0;

	logger.debug(addressInfo);
	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				workers: 2
			}
		});

		serverSocket.on('request', (request, respond) => {
			if (tries === 2) respond({});
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
		mediaService: sut,
	});
	const peer = new Peer({
		id: 'id',
		roomId: 'id'
	});

	await expect(sut.getRouter(room, peer)).resolves.not.toThrow();
	expect(mediaNode1.health.status).toBe(false);
	expect(mediaNode2.health.status).toBe(true);
	expect(mediaNode2.health.status).toBe(true);
	expect(spyGetRouterMediaNode1).toHaveBeenCalled();
	expect(spyGetRouterMediaNode2).toHaveBeenCalled();
	expect(spyGetRouterMediaNode3).not.toHaveBeenCalled();

	mediaNode1.close();
	mediaNode2.close();
	ioServer.close();
	httpServer.close();
	sut.close();
});

test.only('MediaNode should retry connection', async () => {
	const { httpsServer, ioServer, addressInfo } = await init();

	let tries = 0;

	logger.debug(addressInfo);
	ioServer.on('connection', (socket) => {
		const serverSocket = new IOServerConnection(socket);

		serverSocket.notify({
			method: 'mediaNodeReady',
			data: {
				workers: 2
			}
		});

		serverSocket.on('request', (request, respond) => {
			if (tries === 2) respond({});
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

	expect(sut.health.status).toBe(true);

	await expect(sut.getRouter(
		{ roomId: 'id',
			appData: {} }
	)).rejects.toThrow();
	
	expect(sut.health.status).toBe(false);

	const getHealthy = async () => {
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				if (sut.health.status) {
					clearInterval(interval);
					resolve({});
				} 
			}, 25);
		});
	};

	await getHealthy();	// await sut.getRouter({ roomId, appData });
	expect(sut.health.status).toBe(true);
	ioServer.close();
	httpsServer.close();
	sut.close();
});
