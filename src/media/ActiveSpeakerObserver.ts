import { EventEmitter } from 'events';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Producer } from './Producer';

const logger = new Logger('ActiveSpeakerObserver');

export interface ActiveSpeakerObserverOptions {
	id: string;
	interval?: number;
	appData?: Record<string, unknown>;
}

interface InternalActiveSpeakerObserverOptions extends ActiveSpeakerObserverOptions {
	router: Router;
	connection: MediaNodeConnection;
}

export declare interface ActiveSpeakerObserver {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'dominantspeaker', listener: (dominantSpeakerId: string) => void): this;
}

export class ActiveSpeakerObserver extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public activeSpeakerId?: string;
	public appData: Record<string, unknown>;

	constructor({
		router,
		connection,
		id,
		appData = {},
	}: InternalActiveSpeakerObserverOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.connection = connection;
		this.id = id;
		this.appData = appData;

		this.handleConnection();
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.connection.notify({
				method: 'closeActiveSpeakerObserver',
				data: {
					routerId: this.router.id,
					activeSpeakerObserverId: this.id,
				}
			});
		}

		this.emit('close');
	}

	@skipIfClosed
	private handleConnection() {
		logger.debug('handleConnection()');

		this.connection.once('close', () => this.close(true));
	}

	@skipIfClosed
	public setActiveSpeakerId(activeSpeakerId: string): void {
		logger.debug('setActiveSpeakerId() [id:%s, activeSpeakerId:%s]', this.id, activeSpeakerId);

		this.activeSpeakerId = activeSpeakerId;

		this.emit('dominantspeaker', activeSpeakerId);
	}

	@skipIfClosed
	public async addProducer(producer: Producer): Promise<void> {
		logger.debug('addProducer() [id:%s, producerId:%s]', this.id, producer.id);

		await this.connection.request({
			method: 'activeSpeakerObserverAddProducer',
			data: {
				routerId: this.router.id,
				activeSpeakerObserverId: this.id,
				producerId: producer.id
			}
		});
	}

	@skipIfClosed
	public async removeProducer(producer: Producer): Promise<void> {
		logger.debug('removeProducer() [id:%s, producerId:%s]', this.id, producer.id);

		await this.connection.request({
			method: 'activeSpeakerObserverRemoveProducer',
			data: {
				routerId: this.router.id,
				activeSpeakerObserverId: this.id,
				producerId: producer.id
			}
		});
	}
}