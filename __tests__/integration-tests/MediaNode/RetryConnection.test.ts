import { IOServerConnection, KDPoint } from 'edumeet-common';
import https from 'https';
import { Server as IOServer } from 'socket.io';
import MediaNode from '../../../src/media/MediaNode';
import { AddressInfo, ListenOptions } from 'net';
import { readFileSync } from 'fs';
import path from 'path';
import { ConnectionStatus } from '../../../src/media/MediaNodeHealth';

/**
 * Either:
 * 1.) Run this test with valid tls certs in createServer().
 * 2.) Run the tests with NODE_TLS_REJECT_UNAUTHORIZED=0.
 */

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
		// We respond with a 400 on the first attempt from MediaNode to get status.
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

test('MediaNode should retry connection', async () => {
	const { httpsServer, ioServer, addressInfo } = await init();

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

	const spyGet = jest.spyOn(https, 'get'); // used when MediaNode is retrying the connection.
	
	await expect(sut.getRouter(
		{ roomId: 'id',
			appData: {} }
	)).rejects.toThrow();
	
	expect(sut.connectionStatus).toBe(ConnectionStatus.RETRYING);

	// Wait for our MediaNode to get a healthy connection.
	await (async () => {
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				if (sut.connectionStatus === ConnectionStatus.OK) {
					clearInterval(interval);
					resolve({});
				} 
			}, 25);
		});
	})();

	expect(sut.connectionStatus).toBe(ConnectionStatus.OK);
	expect(spyGet).toHaveBeenCalledTimes(2);
	ioServer.close();
	httpsServer.close();
	sut.close();
});
