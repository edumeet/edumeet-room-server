import { KDPoint, KDTree, List } from 'edumeet-common';
import * as geoip from 'geoip-lite';
import 'jest';
import MediaService from '../../src/MediaService';
import { MediaNode } from '../../src/media/MediaNode';
import { Router } from '../../src/media/Router';
import Room from '../../src/Room';
import { Peer } from '../../src/Peer';

jest.mock('geoip-lite', () => ({ lookup: jest.fn() }));

const router = { id: 'router' } as unknown as Router;

const fakeNode = (name: string, getRouter: jest.Mock, position: number[] = [ 50, 10 ]): MediaNode =>
	({
		id: name,
		hostname: `${name}.invalid`,
		port: 3443,
		healthy: true,
		draining: false,
		load: 0,
		kdPoint: new KDPoint(position),
		getRouter
	}) as unknown as MediaNode;

// Rejects the way a media node does ('Server error' is a string, not an Error), but succeeds after
// many calls so an endless retry loop fails the test on its call count instead of hanging the run.
const serverError = (recoverAfter = 20): jest.Mock => {
	const getRouter: jest.Mock = jest.fn(() => {
		if (getRouter.mock.calls.length > recoverAfter) return Promise.resolve(router);

		return Promise.reject('Server error');
	});

	return getRouter;
};

// Fails like a connection timeout: the node marks itself unhealthy as part of the failure.
const timingOutNode = (name: string, position: number[]): MediaNode => {
	const getRouter: jest.Mock = jest.fn(() => {
		(node as unknown as { healthy: boolean }).healthy = false;

		return Promise.reject(new Error('connection timed out'));
	});
	const node = fakeNode(name, getRouter, position);

	return node;
};

const createService = (nodes: MediaNode[]): MediaService => {
	const kdTree = new KDTree([]);

	nodes.forEach((mediaNode) => kdTree.addNode(new KDPoint(mediaNode.kdPoint.position, { mediaNode })));
	kdTree.rebalance();

	return new MediaService({ kdTree, mediaNodes: [], defaultClientPosition: new KDPoint([ 50, 10 ]) });
};

const room = (): Room => ({ id: 'room', sessionId: 'room', closed: false, mediaNodes: List<MediaNode>() }) as unknown as Room;

const peer = (): Peer => ({ id: 'peer', displayName: 'peer', closed: false, getAddress: () => ({ address: undefined }) }) as unknown as Peer;

// Runs a getRouter() call to completion under fake timers, stepping over the pauses between rounds.
const settle = async <T>(promise: Promise<T>): Promise<T> => {
	const outcome = promise.then((value) => ({ value }), (error) => ({ error }));

	for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(1000);

	const result = await outcome;

	if ('error' in result) throw result.error;

	return result.value;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('getRouter() skips a candidate that turned unhealthy while an earlier candidate was being tried', async () => {
	const nodeC = fakeNode('c', jest.fn().mockResolvedValue(router));
	const nodeB = fakeNode('b', jest.fn().mockResolvedValue(router));
	const nodeA = fakeNode('a', jest.fn().mockImplementation(async () => {
		(nodeB as unknown as { healthy: boolean }).healthy = false;

		throw new Error('connection timed out');
	}));

	const mediaService = {
		closed: false,
		getCandidates: jest.fn().mockReturnValue([ nodeA, nodeB, nodeC ])
	};

	const result = await settle(MediaService.prototype.getRouter.call(mediaService, room(), peer()));

	expect(result).toEqual([ router, nodeC ]);
	expect(nodeB.getRouter).not.toHaveBeenCalled();
});

test('getRouter() recovers from a transient node error on the next round without giving up', async () => {
	const failing = serverError(1);
	const node = fakeNode('a', failing);
	const mediaService = createService([ node ]);

	const call = mediaService.getRouter(room(), peer());

	await jest.advanceTimersByTimeAsync(0);
	expect(failing).toHaveBeenCalledTimes(1);

	await jest.advanceTimersByTimeAsync(999);
	expect(failing).toHaveBeenCalledTimes(1);

	await expect(settle(call)).resolves.toEqual([ router, node ]);
	expect(failing).toHaveBeenCalledTimes(2);
});

test('getRouter() asks a node that keeps answering with an error once per round, then gives up', async () => {
	const failing = serverError();
	const node = fakeNode('a', failing);
	const mediaService = createService([ node ]);

	await expect(settle(mediaService.getRouter(room(), peer()))).rejects.toThrow('no media nodes available');
	expect(failing).toHaveBeenCalledTimes(3);
});

test('getRouter() gives up at once when there is no candidate to ask', async () => {
	const mediaService = createService([]);
	const call = mediaService.getRouter(room(), peer());

	await expect(settle(call)).rejects.toThrow('no media nodes available');
});

test('getRouter() moves past the nearest nodes within a round when they all answer with errors', async () => {
	const failingNodes = Array.from({ length: 6 }, (_, i) => fakeNode(`near${i}`, serverError(), [ 50 + i, 10 ]));
	const farNode = fakeNode('far', jest.fn().mockResolvedValue(router), [ 70, 10 ]);
	const mediaService = createService([ ...failingNodes, farNode ]);

	await expect(settle(mediaService.getRouter(room(), peer()))).resolves.toEqual([ router, farNode ]);

	failingNodes.forEach((node) => expect(node.getRouter).toHaveBeenCalledTimes(1));
});

test('getRouter() does not retry a sticky node that answered with an error on a later pass of the same round', async () => {
	const sticky = fakeNode('sticky', serverError(), [ 50, 10 ]);
	const other: MediaNode = fakeNode('other', jest.fn(async () => {
		(other as unknown as { healthy: boolean }).healthy = false;

		throw new Error('connection timed out');
	}), [ 52, 10 ]);
	const mediaService = createService([ sticky, other ]);
	const stickyRoom = room();

	stickyRoom.mediaNodes.add(sticky);

	await expect(settle(mediaService.getRouter(stickyRoom, peer()))).rejects.toThrow('no media nodes available');
	expect(sticky.getRouter).toHaveBeenCalledTimes(3);
	expect(other.getRouter).toHaveBeenCalledTimes(1);
});

test('getRouter() does not retry a node that timed out, only nodes that answered with an error', async () => {
	const timedOut = timingOutNode('timeout', [ 50, 10 ]);
	const erroring = fakeNode('erroring', serverError(1), [ 51, 10 ]);
	const mediaService = createService([ timedOut, erroring ]);

	await expect(settle(mediaService.getRouter(room(), peer()))).resolves.toEqual([ router, erroring ]);
	expect(timedOut.getRouter).toHaveBeenCalledTimes(1);
	expect(erroring.getRouter).toHaveBeenCalledTimes(2);
});

test('getRouter() stops retrying when the peer leaves during the pause', async () => {
	const failing = serverError();
	const mediaService = createService([ fakeNode('a', failing) ]);
	const leavingPeer = peer();
	const call = mediaService.getRouter(room(), leavingPeer);

	await jest.advanceTimersByTimeAsync(0);
	(leavingPeer as unknown as { closed: boolean }).closed = true;

	await expect(settle(call)).rejects.toThrow('no media nodes available');
	expect(failing).toHaveBeenCalledTimes(1);
});

test('getRouter() gives up with no media nodes available when every node keeps failing', async () => {
	const nodes = Array.from({ length: 3 }, (_, i) => fakeNode(`n${i}`, serverError(), [ 50 + i, 10 ]));
	const mediaService = createService(nodes);

	await expect(settle(mediaService.getRouter(room(), peer()))).rejects.toThrow('no media nodes available');

	nodes.forEach((node) => expect(node.getRouter).toHaveBeenCalledTimes(3));
});

test('getRouter() does not re-ask a same-country node that answered with an error earlier in the round', async () => {
	// First joiner from Poland: the same-country step runs and puts the PL node first.
	(geoip.lookup as jest.Mock).mockReturnValue({ country: 'PL', ll: [ 52, 21 ] });

	const plNode = fakeNode('pl', serverError(), [ 52, 21 ]);
	const deNodes = Array.from({ length: 6 }, (_, i) => fakeNode(`de${i}`, i === 5 ? jest.fn().mockResolvedValue(router) : serverError(), [ 52, 21 - (2 * (i + 1)) ]));
	const mediaService = createService([ plNode, ...deNodes ]);
	const countries = (mediaService as unknown as { mediaNodeCountries: Map<string, string> }).mediaNodeCountries;

	countries.set(plNode.hostname, 'PL');
	deNodes.forEach((node) => countries.set(node.hostname, 'DE'));

	const polishPeer = { ...peer(), getAddress: () => ({ address: '1.2.3.4' }) } as unknown as Peer;

	await expect(settle(mediaService.getRouter(room(), polishPeer))).resolves.toEqual([ router, deNodes[5] ]);

	// The successful node lies beyond the five nearest, so this took two passes; the PL node was
	// asked on the first pass only.
	expect(plNode.getRouter).toHaveBeenCalledTimes(1);
	deNodes.slice(0, 5).forEach((node) => expect(node.getRouter).toHaveBeenCalledTimes(1));
});
