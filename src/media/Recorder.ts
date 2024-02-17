import { EventEmitter } from 'events';
import { Router } from './Router';
import { Logger, skipIfClosed } from 'edumeet-common';
import { MediaNode } from './MediaNode';

const logger = new Logger('Recorder');

export interface RecorderOptions {
	id: string;
}

interface InternalRecorderOptions extends RecorderOptions {
	router: Router;
	mediaNode: MediaNode;
	appData?: Record<string, unknown>;
}

export declare interface Recorder {
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: (remoteClose: boolean) => void): this;
}

export class Recorder extends EventEmitter {
	public closed = false;
	public router: Router;
	public mediaNode: MediaNode;
	public id: string;
	public appData: Record<string, unknown>;

	constructor({
		router,
		mediaNode,
		id,
		appData = {},
	}: InternalRecorderOptions) {
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
				method: 'closeRecorder',
				data: {
					routerId: this.router.id,
					recorderId: this.id,
				}
			});
		}

		this.emit('close', remoteClose);
	}
}
