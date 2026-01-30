import fs from 'fs';
import { EventEmitter } from 'events';
import path from 'path';
import { AppConfigParsed, AppConfigSchema } from './schema';

export class ConfigLoader extends EventEmitter {
	private configPath: string;
	private current: AppConfigParsed | null;
	private debounceMs: number;
	private reloadTimer: NodeJS.Timeout | null;

	constructor(configPath: string, debounceMs = 100) {
		super();
		this.current = null;
		this.reloadTimer= null;
		this.configPath = path.resolve(configPath);
		this.debounceMs = debounceMs;
	}

	public get config(): AppConfigParsed | null {
		return this.current;
	}

	loadOnce() {
		try {
			const raw = fs.readFileSync(this.configPath, 'utf-8');
			const parsed = JSON.parse(raw);
			const validated = AppConfigSchema.parse(parsed);

			this.current = validated;
			this.emit('loaded', validated);
		} catch (err) {
			this.emit('error', err);
			if (!this.current) {
				// no prior valid config: rethrow so caller knows
				throw err;
			}
		}
	}

	reload() {
		try {
			const raw = fs.readFileSync(this.configPath, 'utf-8');
			const parsed = JSON.parse(raw);
			const validated = AppConfigSchema.parse(parsed);
			const changed = JSON.stringify(validated) !== JSON.stringify(this.current);

			if (changed) {
				this.current = validated;
				this.emit('reloaded', validated);
			} else {
				this.emit('unchanged', validated);
			}
		} catch (err) {
			this.emit('error', err);
		}
	}

	scheduleReload() {
		if (this.reloadTimer) {
			clearTimeout(this.reloadTimer);
		}
		this.reloadTimer = setTimeout(() => {
			this.reload();
		}, this.debounceMs);
	}
}
