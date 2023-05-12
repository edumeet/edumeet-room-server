import LoadBalancer from '../../src/LoadBalancer';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';
import MediaService from '../../src/MediaService';
import { Config } from '../../src/Config';
import { KDPoint, KDTree } from 'edumeet-common';

/**
 * Requires mediaNode running with config
 * hostname: 127.0.0.1
 * port: 3001
 * secret: secret1
 */

test('getRouter() should throw on no mediaNodes', async () => {
	const config = {
		mediaNodes: []
	} as unknown as Config;
	const kdTree = new KDTree([]);
	const defaultClientPosition = new KDPoint([ 50, 10 ]);
	const loadBalancer = new LoadBalancer({ kdTree, defaultClientPosition });
	const sut = MediaService.create(loadBalancer, kdTree, config);

	const roomOptions = {
		id: 'roomId',
		mediaService: sut,
	};
	const room = new Room(roomOptions);
	const peerOptions = {
		id: 'peerId',
		sessionId: 'roomId'
	};
	const peer = new Peer(peerOptions);

	await expect(sut.getRouter(room, peer)).rejects.toThrow();
});

test('getRouter() should get router', async () => {
	const config = {
		mediaNodes: [
			{
				hostname: '127.0.0.1',
				port: 3001,
				secret: 'secret1',
				latitude: 55.676,
				longitude: 12.568
			}
		]
	} as unknown as Config;
	const kdTree = new KDTree([]);

	const defaultClientPosition = new KDPoint([ 50, 10 ]);
	const loadBalancer = new LoadBalancer({ kdTree, defaultClientPosition });
	const sut = MediaService.create(loadBalancer, kdTree, config);

	const roomOptions = {
		id: 'roomId',
		mediaService: sut,
	};
	const room = new Room(roomOptions);
	const peerOptions = {
		id: 'peerId',
		sessionId: 'roomId'
	};
	const peer = new Peer(peerOptions);
	const clientAddress = {
		address: '127.0.0.1',
		forwardedFor: undefined
	};

	jest.spyOn(peer, 'getAddress').mockReturnValue(clientAddress);

	expect(room.routers.length).toBe(0);

	const router = await sut.getRouter(room, peer);

	expect(room.routers.length).toBe(1);
	expect(router.closed).toBeFalsy();
	expect(router.appData.roomId).toBe(room.id);
	router.close();
});