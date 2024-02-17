import 'jest';
import { Router } from '../../src/media/Router';
import MediaNode from '../../src/media/MediaNode';
import { SctpParameters } from 'mediasoup-client/lib/SctpParameters';
import { KDPoint } from 'edumeet-common';
import { Producer } from '../../src/media/Producer';
import { Consumer } from '../../src/media/Consumer';
import { WebRtcTransport } from '../../src/media/WebRtcTransport';
import { DtlsParameters, IceCandidate, IceParameters } from 'mediasoup/node/lib/WebRtcTransport';

const fakePoint = {} as unknown as KDPoint;
const create = () => {
	const mediaNode = new MediaNode({
		id: 'mediaNodeId',
		hostname: 'h',
		port: 1234,
		secret: 's',
		kdPoint: fakePoint
	});
	const router = new Router({
		mediaNode,
		id: 'routerId',
		rtpCapabilities: {},
	});
	
	return {
		mediaNode,
		router
	};
};
const transportId = 'transportId';
const iceParameters = {} as IceParameters;
const iceCandidates = [] as IceCandidate[];
const dtlsParameters = {} as DtlsParameters;
const sctpParameters = {} as SctpParameters;

it('Has correct properties', () => {
	const { mediaNode, router } = create();
	const webRtcTransport = new WebRtcTransport({
		router,
		mediaNode,
		id: transportId,
		iceParameters,
		iceCandidates,
		dtlsParameters,
		sctpParameters,
	});

	expect(webRtcTransport.closed).toBe(false);
	expect(webRtcTransport.id).toBe(transportId);
	expect(webRtcTransport.consumers.size).toBe(0);
});

it('close()', () => {
	const { mediaNode, router } = create();
	const webRtcTransport = new WebRtcTransport({
		router,
		mediaNode,
		id: transportId,
		iceParameters,
		iceCandidates,
		dtlsParameters,
		sctpParameters,
	});

	const close = jest.fn();

	const c = { id: 'id', close } as unknown as Consumer;
	const p = { id: 'id', close } as unknown as Producer;

	webRtcTransport.consumers.set(c.id, c);
	webRtcTransport.producers.set(p.id, p);
	webRtcTransport.close();

	expect(webRtcTransport.closed).toBe(true);
	expect(close).toHaveBeenCalledTimes(2);
});
