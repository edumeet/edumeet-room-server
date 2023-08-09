import { AddressInfo, ListenOptions } from 'net';

import { Server as IOServer } from 'socket.io';
import https from 'node:https';
import { readFileSync } from 'fs';
import path from 'path';
import { MediaNodeConnection } from '../../src/media/MediaNodeConnection';

const createServer = async (): Promise<{
	httpServer: https.Server,
	ioServer: IOServer,
	addressInfo?: AddressInfo,
    url: string
}> => {
	const options: ListenOptions = {
		host: 'localhost',
		port: Math.floor((Math.random() * (60000)) + 3000)
	};
	const httpsServer = https.createServer({
		cert: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-cert.pem')),
		key: readFileSync(path.join(process.cwd(), './certs/edumeet-demo-key.pem'))
	}).listen(options);

	return new Promise((resolve) => {
		httpsServer.on('listening', () => {
			const addressInfo = httpsServer.address() as AddressInfo;
			const ioServer = new IOServer(httpsServer);
		
			resolve({
				httpServer: httpsServer,
				ioServer,
				url: `wss://${addressInfo.address}:${addressInfo.port}`
			});
		});
	});

};

it('close()', () => {
	const sut = new MediaNodeConnection({
		url: 'url',
		timeout: 500
	});

	expect(sut.closed).toBe(false);
	sut.close();
	expect(sut.closed).toBe(true);
});

it('should reject on socket timeout', async () => {
	const sut = new MediaNodeConnection({
		url: 'url',
		timeout: 10
	});

	await expect(sut.ready).rejects.toBe('Timeout waiting for media-node connection');
	sut.close();
});

it('mediaNodeReady', async () => {
	const { ioServer, httpServer, url } = await createServer();

	ioServer.on('connect', (socket) => {
		socket.emit('notification', {
			method: 'mediaNodeReady',
			data: {
				workers: 2
			}
		});
	});

	const sut = new MediaNodeConnection({
		url,
		timeout: 3000
	});

	await expect(sut.ready).resolves.toBe(undefined);
	ioServer.close();
	httpServer.close();
	sut.close();
});