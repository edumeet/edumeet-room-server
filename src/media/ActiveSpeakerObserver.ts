import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { Producer } from './Producer';
import { MediaNode } from './MediaNode';

const logger = new Logger('ActiveSpeakerObserver');

export interface ActiveSpeakerObserverOptions {
	id: string;
	interval?: number;
	appData?: Record<string, unknown>;
}

interface InternalActiveSpeakerObserverOptions extends ActiveSpeakerObserverOptions {
	router: Router;
	mediaNode: MediaNode;
}

export declare interface ActiveSpeakerObserver {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'dominantspeaker', listener: (dominantSpeakerId: string) => void): this;
}

export class ActiveSpeakerObserver extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public activeSpeakerId?: string;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		appData = {},
	}: InternalActiveSpeakerObserverOptions) {
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
				method: 'closeActiveSpeakerObserver',
				data: {
					routerId: this.router.id,
					activeSpeakerObserverId: this.id,
				}
			});
		}

		this.emit('close', remoteClose);
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

		await this.mediaNode.request({
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

		await this.mediaNode.request({
			method: 'activeSpeakerObserverRemoveProducer',
			data: {
				routerId: this.router.id,
				activeSpeakerObserverId: this.id,
				producerId: producer.id
			}
		});
	}
}
