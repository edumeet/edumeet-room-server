import { IOClientConnection, } from 'edumeet-common';
import { MediaNodeConnection } from '../../src/media/MediaNodeConnection';
import { createServer, Server } from 'http';
import { Server as IOServer } from 'socket.io';
import { AddressInfo } from 'net';

let socket: IOClientConnection;
let httpServer: Server;
let httpServerAddr: AddressInfo;
let ioServer: IOServer;

/**
 * Setup WS & HTTP servers
 */
beforeAll((done) => {
	httpServer = createServer().listen();
	httpServerAddr = httpServer.address() as unknown as AddressInfo;
	ioServer = new IOServer(httpServer);
	done();
});

/**
 *  Cleanup WS & HTTP servers
 */
afterAll((done) => {
	ioServer.close();
	httpServer.close();
	done();
});

/**
 * Run before each test
 */
beforeEach((done) => {
	// Setup
	// Do not hardcode server port and address, square brackets are used for IPv6
	const url = `http://[${httpServerAddr?.address}]:${httpServerAddr.port}`;

	socket = IOClientConnection.create({ url });
	socket.on('connect', () => {
		done();
	});
});

/**
 * Run after each test
 */
afterEach((done) => {
	// Cleanup
	if (!socket.closed) {
		socket.close();
	}
	done();
});

describe('Error handling', () => {
	test('', async () => {
		const sut = new MediaNodeConnection(
			{ connection: socket }
		);

		ioServer.emit('notification', {
			method: 'mediaNodeReady',
			data: {
				load: 0
			}
		});

		await sut.ready;
		ioServer.emit('request', {
			method: 'getRouter'
		});

		const res = await sut.request({
			method: 'getRouter'
		});
	});
});