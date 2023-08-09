import { KDPoint } from 'edumeet-common';
import 'jest';
import MediaNode from '../../src/media/MediaNode';
import { Router } from '../../src/media/Router';

it('Has correct properties', () => {
	const mediaNode = new MediaNode({
		id: 'id',
		hostname: 'h',
		port: 3000,
		secret: 's',
		kdPoint: {} as unknown as KDPoint
	});

	expect(mediaNode.id).toBe('id');
	expect(mediaNode.hostname).toBe('h');
	expect(mediaNode.closed).toBe(false);
	expect(mediaNode.port).toBe(3000);
});

it('close()', () => {
	const mediaNode = new MediaNode({
		id: 'id',
		hostname: 'h',
		port: 3000,
		secret: 's',
		kdPoint: {} as unknown as KDPoint
	});

	const close = jest.fn();
	const router = { id: 'id', close } as unknown as Router;

	mediaNode.routers.set(router.id, router);
	mediaNode.close();
	expect(mediaNode.closed).toBe(true);
	expect(mediaNode.routers.size).toBe(0);
	expect(close).toHaveBeenCalledTimes(1);
	
});