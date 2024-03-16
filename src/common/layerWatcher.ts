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

	private resetLayerEmitted = false;
	private resetLayerEmitTimeout?: NodeJS.Timeout;

	constructor() {
		super();

		this.resetLayers(true);
	}

	public close(): void {
		clearTimeout(this.resetLayerEmitTimeout);

		this.removeAllListeners();
	}

	public resetLayers(initial = false): void {
		clearTimeout(this.resetLayerEmitTimeout);

		this.resetLayerEmitted = false;
	
		if (!initial) this.emit('newLayer', 2);

		this.resetLayerEmitTimeout = setTimeout(() => {
			this.resetLayerEmitted = true;

			this.emit('newLayer', this.currentLayer);
		}, 10_000);
	}

	public createLayerReporter(): LayerReporter {
		const layerReporter = new LayerReporter();

		this.layerReporters.push(layerReporter);

		layerReporter.on('close', () => {
			this.layerReporters = this.layerReporters.filter((l) => l !== layerReporter);

			if (this.layerReporters.length === 0) return;

			const { layer } = this.layerReporters.reduce((prev, current) => ((prev.layer > current.layer) ? prev : current));

			if (layer !== this.currentLayer) {
				this.currentLayer = layer;

				if (!this.resetLayerEmitted) return;

				this.emit('newLayer', this.currentLayer);
			}
		});

		layerReporter.on('updateLayer', () => {
			const { layer } = this.layerReporters.reduce((prev, current) => ((prev.layer > current.layer) ? prev : current));

			if (layer !== this.currentLayer) {
				this.currentLayer = layer;

				if (!this.resetLayerEmitted) return;

				this.emit('newLayer', this.currentLayer);
			}
		});

		layerReporter.on('resetLayers', () => this.resetLayers());

		return layerReporter;
	}
}
