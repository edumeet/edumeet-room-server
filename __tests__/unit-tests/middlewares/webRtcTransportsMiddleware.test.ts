import { Next } from 'edumeet-common';
import { Router } from '../../../src/media/Router';
import { WebRtcTransport } from '../../../src/media/WebRtcTransport';
import { createWebRtcTransportsMiddleware } from '../../../src/middlewares/webRtcTransportsMiddleware';
import { PeerContext } from '../../../src/Peer';

const ID = 'id';
const next = jest.fn as unknown as Next;

test('Should not handle unrelated message', async () => {
	const webRtcTransport = {
		id: ID,
		router: {
			id: ID
		}
	} as unknown as WebRtcTransport;

	const webRtcTransports = new Map<string, WebRtcTransport>();

	webRtcTransports.set(webRtcTransport.id, webRtcTransport);

	const router = {
		id: ID,
		webRtcTransports
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createWebRtcTransportsMiddleware({ routers });

	const context = {
		message: {
			method: 'non-existing-method',
			data: {
				routerId: ID,
				transportId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeFalsy();
});

test('webRtcTransportClosed() - Should close webRtcTransport', async () => {
	const close = jest.fn();
	const webRtcTransport = {
		id: ID,
		router: {
			id: ID
		},
		close
	} as unknown as WebRtcTransport;

	const webRtcTransports = new Map<string, WebRtcTransport>();

	webRtcTransports.set(webRtcTransport.id, webRtcTransport);

	const router = {
		id: ID,
		webRtcTransports
	} as unknown as Router;

	const routers = new Map<string, Router>();

	routers.set(router.id, router);

	const sut = createWebRtcTransportsMiddleware({ routers });

	const context = {
		message: {
			method: 'webRtcTransportClosed',
			data: {
				routerId: ID,
				transportId: ID
			}
		}
	} as unknown as PeerContext;

	await sut(context, next);

	expect(context.handled).toBeTruthy();
	expect(close).toHaveBeenCalled();
});
