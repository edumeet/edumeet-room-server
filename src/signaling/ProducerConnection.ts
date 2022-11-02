import { BaseConnection } from './BaseConnection';
import { SocketMessage } from './SignalingInterface';
import { Logger } from '../common/logger';
import { SocketTimeoutError } from '../common/SocketTimeoutError';
import { skipIfClosed } from '../common/decorators';
import { DataProducer } from 'mediasoup/node/lib/DataProducer';
import { Router } from 'mediasoup/node/lib/Router';
import { DirectTransport } from 'mediasoup/node/lib/DirectTransport';
import { DataConsumer } from 'mediasoup/node/lib/DataConsumer';
import { RawSocket, RawSocketMessage, SentRequest } from './RawSocket';

const logger = new Logger('ProducerConnection');

export class ProducerConnection extends BaseConnection {
	public static async create(
		producer: DataProducer,
		router: Router
	): Promise<ProducerConnection> {
		logger.debug('create()');

		const transport = await router.createDirectTransport({ maxMessageSize: 512 });
		const incomingConsumer = await transport.consumeData({ dataProducerId: producer.id });
		const outgoingProducer = await transport.produceData({ label: 'signaling' });

		const connection = new ProducerConnection(
			transport,
			incomingConsumer,
			outgoingProducer
		);

		producer.observer.once('close', () => connection.close());

		return connection;
	}

	public closed = false;
	private sentRequests = new Map<string, SentRequest>();
	private transport: DirectTransport;
	public incomingConsumer: DataConsumer;
	public outgoingProducer: DataProducer;

	constructor(
		transport: DirectTransport,
		incomingConsumer: DataConsumer,
		outgoingProducer: DataProducer,
	) {
		super();

		logger.debug('constructor()');

		this.transport = transport;
		this.incomingConsumer = incomingConsumer;
		this.outgoingProducer = outgoingProducer;

		this.handleConnection();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close() [id: %s]', this.id);

		this.closed = true;

		this.sentRequests.forEach((r) => r.close());
		this.outgoingProducer.close();
		this.incomingConsumer.close();
		this.transport.close();

		this.emit('close');
	}

	public get id(): string {
		return this.incomingConsumer.dataProducerId;
	}

	@skipIfClosed
	public async notify(notification: SocketMessage): Promise<void> {
		logger.debug('notification() [notification: %o]', notification);

		const rawNotification = RawSocket.createNotification(
			notification.method,
			notification.data
		);

		this.outgoingProducer.send(JSON.stringify(rawNotification));
	}

	@skipIfClosed
	private sendRequestOnWire(rawRequest: RawSocketMessage): Promise<unknown> {
		this.outgoingProducer.send(JSON.stringify(rawRequest));

		return new Promise((pResolve, pReject) => {
			const timeout = 1500 * (15 + (0.1 * this.sentRequests.size));
			const sent = {
				id: rawRequest.id,
				method: rawRequest.method,
				resolve: (data: unknown) => {
					if (!this.sentRequests.delete(rawRequest.id))
						return;

					clearTimeout(sent.timer);
					pResolve(data);
				},
				reject: (error: unknown) => {
					if (!this.sentRequests.delete(rawRequest.id))
						return;

					clearTimeout(sent.timer);
					pReject(error);
				},
				timer: setTimeout(() => {
					if (!this.sentRequests.delete(rawRequest.id))
						return;

					pReject(new SocketTimeoutError('request timeout'));
				}, timeout),
				close: () => {
					clearTimeout(sent.timer);
					pReject(new Error('transport closed'));
				}
			} as SentRequest;

			this.sentRequests.set(rawRequest.id, sent);
		});
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('sendRequest() [request: %o]', request);

		const rawRequest = RawSocket.createRequest(request.method, request.data);

		return await this.sendRequestOnWire(rawRequest);
	}

	private handleConnection(): void {
		logger.debug('handleConnection()');

		this.incomingConsumer.observer.once('close', () => {
			logger.debug('incomingConsumer "close" event');

			this.close();
		});

		this.incomingConsumer.on('message', (message: Buffer, ppid: number) => {
			logger.debug('incomingConsumer "message" event [message: %s, ppid: %d]', message, ppid);

			if (ppid !== 51)
				return logger.warn('ignoring non string message from a Peer');

			const text = message.toString('utf8');

			try {
				const socketMessage = JSON.parse(text) as RawSocketMessage;

				logger.debug('socketMessage: %o', socketMessage);

				if (socketMessage.request) {
					this.emit(
						'request',
						{
							method: socketMessage.method,
							data: socketMessage.data
						} as SocketMessage,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(response: any) => {
							const rawResponse =
								RawSocket.createSuccessResponse(socketMessage, response);

							this.outgoingProducer.send(JSON.stringify(rawResponse));
						},
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(error: any) => {
							const rawResponse =
								RawSocket.createErrorResponse(socketMessage, error);

							this.outgoingProducer.send(JSON.stringify(rawResponse));
						}
					);
				} else if (socketMessage.response) {
					const sent = this.sentRequests.get(socketMessage.id);

					if (!sent)
						return logger.warn('unknown response [id: %s]', socketMessage.id);

					if (socketMessage.errorReason)
						sent.reject(socketMessage.errorReason);
					else
						sent.resolve(socketMessage.data);
				} else if (socketMessage.notification) {
					this.emit(
						'notification',
						{
							method: socketMessage.method,
							data: socketMessage.data
						} as SocketMessage
					);
				}
			} catch (error) {
				logger.warn('"message" parsing [error: %o]', error);
			}
		});
	}
}