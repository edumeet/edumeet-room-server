import { IOServerConnection, KDPoint } from 'edumeet-common';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import MediaNode from '../../../src/media/MediaNode';
import { AddressInfo, ListenOptions } from 'net';
import { readFileSync } from 'fs';
import path from 'path';
import MediaService from '../../../src/MediaService';
import LoadBalancer from '../../../src/LoadBalancer';
import Room from '../../../src/Room';
import { Peer } from '../../../src/Peer';
import { ConnectionStatus } from '../../../src/media/MediaNodeHealth';

/**
 * Either:
 * 1.) Run this test with valid tls certs in createServer().
 * 2.) Run the tests with NODE_TLS_REJECT_UNAUTHORIZED=0.
 */

jest.setTimeout(30000);

const init = async (): Promise<{
	httpsServer: https.Server,
	ioServer: IOServer,
	addressInfo: AddressInfo
}> => {
	const options: ListenOptions = {
		host: 'localhost',
		port: Math.floor((Math.random() * (60000)) + 3000)
	};
	let count = 0; // Used to simulate network error.

	const httpsServer = https.createServer({
		cert: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-cert.pem')),
		key: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-key.pem'))
	}, (req, res) => {
		// This will make the first candidate retry its connection while we accept the second candidate.
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

test('MediaService.getRouter() should stop trying on successful candidate', async () => {
	const { httpsServer: httpServer, ioServer, addressInfo } = await init();

	let tries = 0; // Used to simulate network error

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
			// We let the first request timeout to simulate network error.
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
	
	const spyGet = jest.spyOn(https, 'get'); // used when MediaNode is retrying the connection.

	await expect(sut.getRouter(room, peer)).resolves.not.toThrow();
	expect(mediaNode1.connectionStatus).toBe(ConnectionStatus.RETRYING);
	expect(mediaNode2.connectionStatus).toBe(ConnectionStatus.OK);
	expect(spyGetRouterMediaNode1).toHaveBeenCalled();
	expect(spyGetRouterMediaNode2).toHaveBeenCalled();
	expect(spyGetRouterMediaNode3).not.toHaveBeenCalled();

	// Wait for our MediaNode to get a healthy connection.
	await (async () => {
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				if (mediaNode1.connectionStatus === ConnectionStatus.OK) {
					clearInterval(interval);
					resolve({});
				} 
			}, 25);
		});
	})();

	expect(mediaNode1.connectionStatus).toBe(ConnectionStatus.OK);
	expect(spyGet).toHaveBeenCalledTimes(2);

	mediaNode1.close();
	mediaNode2.close();
	ioServer.close();
	httpServer.close();
	sut.close();
});