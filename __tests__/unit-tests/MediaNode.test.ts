import path from 'path';
import { KDPoint } from 'edumeet-common';
import 'jest';
import { MediaNode } from '../../src/media/MediaNode';
import { Router } from '../../src/media/Router';

it('Has correct properties', () => {
	const mediaNode = new MediaNode({
		id: 'id',
		hostname: 'h',
		port: 3000,
		secret: 's',
		turnports: [],
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
		turnports: [],
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
describe('TLS of the control connection', () => {
	const options = { id: 'id', hostname: 'h', port: 3000, secret: 's', turnports: [], kdPoint: {} as unknown as KDPoint };

	it('verifies against a readable ca file', () => {
		const ca = path.join(__dirname, '..', 'fixtures', 'media-node-test.crt');
		const mediaNode = new MediaNode({ ...options, ca });

		expect(mediaNode.tls.rejectUnauthorized).toBe(true);
		expect(mediaNode.tls.ca).toContain('BEGIN CERTIFICATE');
		mediaNode.close();
	});

	it('does not throw on an unreadable ca file and does not fall back to an unchecked connection', () => {
		let mediaNode: MediaNode | undefined;

		expect(() => {
			mediaNode = new MediaNode({ ...options, ca: '/nonexistent/media-node-cert.pem' });
		}).not.toThrow();
		expect(mediaNode?.tls).toEqual({ rejectUnauthorized: true });
		mediaNode?.close();
	});

	it('keeps an explicit rejectUnauthorized: false without ca', () => {
		const mediaNode = new MediaNode({ ...options, rejectUnauthorized: false });

		expect(mediaNode.tls).toEqual({ rejectUnauthorized: false });
		mediaNode.close();
	});
});
