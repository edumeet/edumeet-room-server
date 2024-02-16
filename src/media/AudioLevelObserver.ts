import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Producer } from './Producer';
import { MediaNode } from './MediaNode';

const logger = new Logger('AudioLevelObserver');

export interface AudioLevelObserverOptions {
	id: string;
	interval?: number;
	appData?: Record<string, unknown>;
}

interface InternalAudioLevelObserverOptions extends AudioLevelObserverOptions {
	router: Router;
	mediaNode: MediaNode;
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
	public mediaNode: MediaNode;
	public id: string;
	public audioLevels?: AudioLevels;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		appData = {},
	}: InternalAudioLevelObserverOptions) {
		logger.debug('constructor()');

		super();

		this.router = router;
		this.mediaNode = mediaNode;
		this.id = id;
		this.appData = appData;
	}

	@skipIfClosed
	public close(remoteClose = false): void {
		logger.debug('close() [id:%s, remoteClose:%s]', this.id, remoteClose);

		this.closed = true;

		if (!remoteClose) {
			this.mediaNode.notify({
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
	public setAudioLevels(audioLevels: AudioLevels): void {
		logger.debug('setAudioLevelId() [id:%s, audioLevels:%o]', this.id, audioLevels);

		this.audioLevels = audioLevels;

		this.emit('volumes', audioLevels);
	}

	@skipIfClosed
	public async addProducer(producer: Producer): Promise<void> {
		logger.debug('addProducer() [id:%s, producer:%o]', this.id, producer);

		await this.mediaNode.request({
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

		await this.mediaNode.request({
			method: 'audioLevelObserverRemoveProducer',
			data: {
				routerId: this.router.id,
				audioLevelObserverId: this.id,
				producerId: producer.id,
			}
		});
	}
}
