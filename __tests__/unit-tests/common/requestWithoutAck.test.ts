import 'jest';
import { EventEmitter } from 'events';
import { Socket } from 'socket.io';
import { Peer } from '../../../src/Peer';
import { IOServerConnection } from '../../../src/common/IOServerConnection';

// server.ts ends the process on any unhandled rejection, so a request event must never
// make the request listener reject, whatever the client sends.
describe('socket.io request without a usable acknowledgement', () => {
	let socket: EventEmitter;
	let rejections: unknown[];
	let peer: Peer;
	const onRejection = (reason: unknown) => rejections.push(reason);

	const settle = () => new Promise((resolve) => setImmediate(resolve));

	beforeEach(() => {
		rejections = [];
		process.on('unhandledRejection', onRejection);

		socket = new EventEmitter();
		Object.assign(socket, {
			id: 'attacker',
			join: jest.fn(),
			leave: jest.fn(),
			emit: EventEmitter.prototype.emit,
			disconnect: jest.fn(),
			handshake: { address: '127.0.0.1', headers: {} },
		});

		const connection = new IOServerConnection(socket as unknown as Socket);

		peer = new Peer({ id: 'p1', sessionId: 's1', reconnectKey: 'k1', connection });
	});

	afterEach(() => {
		peer.close();
		process.off('unhandledRejection', onRejection);
	});

	it('ignores a request with no acknowledgement', async () => {
		expect(() => socket.emit('request', { method: 'anything' })).not.toThrow();
		await settle();
		expect(rejections).toEqual([]);
	});

	it('ignores a request whose acknowledgement is not a function', async () => {
		expect(() => socket.emit('request', { method: 'anything' }, 'junk')).not.toThrow();
		await settle();
		expect(rejections).toEqual([]);
	});

	it('answers a malformed request with an error', async () => {
		const ack = jest.fn();

		socket.emit('request', null, ack);
		socket.emit('request', { method: 42 }, ack);
		await settle();
		expect(ack).toHaveBeenCalledTimes(2);
		expect(ack).toHaveBeenCalledWith('Invalid request', null);
		expect(rejections).toEqual([]);
	});

	it('survives an acknowledgement that throws', async () => {
		const ack = jest.fn(() => {
			throw new Error('client went away');
		});

		socket.emit('request', { method: 'unknownMethod' }, ack);
		await settle();
		expect(ack).toHaveBeenCalled();
		expect(rejections).toEqual([]);
	});
});
