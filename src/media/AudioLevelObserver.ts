import { EventEmitter } from 'events';
import { MediaNodeConnection } from './MediaNodeConnection';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Producer } from './Producer';

const logger = new Logger('AudioLevelObserver');

export interface AudioLevelObserverOptions {
	id: string;
	interval?: number;
	appData?: Record<string, unknown>;
}

interface InternalAudioLevelObserverOptions extends AudioLevelObserverOptions {
	router: Router;
	connection: MediaNodeConnection;
}

interface AudioLevel {
	producerId: string;
	volume: number;
}

export type AudioLevels = AudioLevel[];

export declare interface AudioLevelObserver {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'volumes', listener: (audioLevels: AudioLevels) => void): this;
}

export class AudioLevelObserver extends EventEmitter {
	public closed = false;
	public router: Router;
	public connection: MediaNodeConnection;
	public id: string;
	public audioLevels?: AudioLevels;
	public appData: Record<string, unknown>;

	constructor({
		router,
		connection,
		id,
		appData = {},
	}: InternalAudioLevelObserverOptions) {
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
				method: 'closeAudioLevelObserver',
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
	public setAudioLevels(audioLevels: AudioLevels): void {
		logger.debug('setAudioLevelId() [id:%s, audioLevels:%o]', this.id, audioLevels);

		this.audioLevels = audioLevels;

		this.emit('volumes', audioLevels);
	}

	@skipIfClosed
	public async addProducer(producer: Producer): Promise<void> {
		logger.debug('addProducer() [id:%s, producer:%o]', this.id, producer);

		await this.connection.request({
			method: 'audioLevelObserverAddProducer',
			data: {
				routerId: this.router.id,
				audioLevelObserverId: this.id,
				producerId: producer.id,
			}
		});
	}

	@skipIfClosed
	public async removeProducer(producer: Producer): Promise<void> {
		logger.debug('removeProducer() [id:%s, producer:%o]', this.id, producer);

		await this.connection.request({
			method: 'audioLevelObserverRemoveProducer',
			data: {
				routerId: this.router.id,
				audioLevelObserverId: this.id,
				producerId: producer.id,
			}
		});
	}
}