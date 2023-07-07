import EventEmitter from 'events';
import { LayerReporter } from './layerReporter';

export type Layer = number;

export declare interface LayerWatcher {
	// eslint-disable-next-line no-unused-vars
	on(event: 'newLayer', listener: (layer: Layer) => void): this;
}

/**
 * LayerWatcher is a class that correlates the reports from all
 * LayerReporter instances and emits the current highest layer
 * a consumer is consuming.
 * 
 * @emits newLayer - Emitted when the layer changes.
 */
export class LayerWatcher extends EventEmitter {
	private layerReporters: LayerReporter[] = [];
	private currentLayer: Layer = 2;

	public createLayerReporter(): LayerReporter {
		const layerReporter = new LayerReporter();

		this.layerReporters.push(layerReporter);

		layerReporter.on('close', () => {
			this.layerReporters = this.layerReporters.filter((l) => l !== layerReporter);

			if (this.layerReporters.length === 0)
				return;

			const { layer } = this.layerReporters.reduce((prev, current) => ((prev.layer > current.layer) ? prev : current));

			if (layer !== this.currentLayer) {
				this.currentLayer = layer;

				this.emit('newLayer', this.currentLayer);
			}
		});

		layerReporter.on('updateLayer', (): void => {
			const { layer } = this.layerReporters.reduce((prev, current) => ((prev.layer > current.layer) ? prev : current));

			if (layer !== this.currentLayer) {
				this.currentLayer = layer;

				this.emit('newLayer', this.currentLayer);
			}
		});

		return layerReporter;
	}
}