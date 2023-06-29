import LoadBalancer from '../../src/LoadBalancer';
import { Peer } from '../../src/Peer';
import Room from '../../src/Room';
import MediaService from '../../src/MediaService';
import { Config } from '../../src/Config';
import { KDPoint, KDTree } from 'edumeet-common';
jest.setTimeout(30000);

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
		sessionId: 'roomId',
	};
	const peer = new Peer(peerOptions);
	const clientAddress = {
		address: '127.0.0.1',
		forwardedFor: undefined
	};

	jest.spyOn(peer, 'getAddress').mockReturnValue(clientAddress);

	await expect(sut.getRouter(room, peer)).rejects.toThrow();
	sut.close();
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

	const router = await sut.getRouter(room, peer);

	expect(router.closed).toBeFalsy();
	expect(router.appData.roomId).toBe(room.id);
	router.close();
});

test('getRouter() should try all media-nodes', async () => {
	const mediaNodes = [];

	for (let i = 0; i < 6; i++) {
		mediaNodes.push({
			hostname: '127.0.0.1',
			port: 9999,
			secret: 'secret1',
			latitude: 55.676,
			longitude: 12.568
		});
	} 
	
	const config = { mediaNodes } as unknown as Config;
	const kdTree = new KDTree([]);

	const defaultClientPosition = new KDPoint([ 50, 10 ]);
	const loadBalancer = new LoadBalancer({ kdTree, defaultClientPosition });
	const sut = MediaService.create(loadBalancer, kdTree, config);

	// for (const mn of sut.mediaNodes.items) {
	// 	mn.health = false;
	// }

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
	const spyGetCandidates = jest.spyOn(loadBalancer, 'getCandidates');
	const spyNearest = jest.spyOn(kdTree, 'nearestNeighbors');

	expect(sut.mediaNodes.length).toBe(6);

	await expect(sut.getRouter(room, peer)).rejects.toThrow();

	expect(spyGetCandidates).toHaveBeenCalledTimes(3);
	expect(spyNearest).toHaveBeenCalledTimes(3);
	expect(spyGetCandidates.mock.results[0].value.length).toBe(5);
	expect(spyGetCandidates.mock.results[1].value.length).toBe(1);
	expect(spyGetCandidates.mock.results[2].value.length).toBe(0);
	sut.close();
});