import EventEmitter from 'events';
import { Layer } from './layerWatcher';

export declare interface LayerReporter {
	// eslint-disable-next-line no-unused-vars
	on(event: 'updateLayer', listener: () => void): this;
	// eslint-disable-next-line no-unused-vars
	on(event: 'close', listener: () => void): this;
}

/**
 * LayerReporter is a class that reports the spatial layer of a consumer.
 * Any time the layer changes, it emits an 'updateLayer' event. Any
 * consumer should have a ResolutionReporter attached to it.
 * 
 * @emits updateLayer - Emitted when the layer changes.
 * @emits close - Emitted when the consumer closes.
 */
export class LayerReporter extends EventEmitter {
	public layer: Layer = 2;

	public close(): void {
		this.emit('close');
		this.removeAllListeners();
	}

	public updateLayer(layer: Layer): void {
		if (layer !== this.layer) {
			this.layer = layer;

			this.emit('updateLayer');
		}
	}
}