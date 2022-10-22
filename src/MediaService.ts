import { Logger } from './common/logger';
import * as mediasoup from 'mediasoup';
import os from 'os';
import { Router } from 'mediasoup/node/lib/Router';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import { Transport } from 'mediasoup/node/lib/Transport';
import { RtpHeaderExtension } from 'mediasoup/node/lib/RtpParameters';
import {
	Worker,
	WorkerLogLevel,
	WorkerLogTag
} from 'mediasoup/node/lib/Worker';
import Room from './Room';
import { skipIfClosed } from './common/decorators';
import { List } from './common/list';
import { Peer } from './Peer';
import { AudioLevelObserver } from 'mediasoup/node/lib/AudioLevelObserver';

const logger = new Logger('MediaService');

interface WorkerSettings {
	logLevel?: WorkerLogLevel;
	logTags?: WorkerLogTag[];
	rtcMinPort?: number;
	rtcMaxPort?: number;
	appData: {
		serverData: WorkerData;
	};
}

export interface WorkerData {
	consumers: Map<string, Consumer>;
	routersByRoomId: Map<string, Router>;
}

export interface RouterData {
	roomId: string;
	workerPid: number;
	pipePromises: Map<string, Promise<void>>;
	peers: Map<string, Peer>;
	audioLevelObserverPromise: Promise<AudioLevelObserver>;
}

export default class MediaService {
	public static async create(): Promise<MediaService> {
		logger.debug('create()');

		const mediaService = new MediaService();

		await mediaService.startWorkers();

		return mediaService;
	}

	public closed = false;
	public workers = List<Worker>();

	@skipIfClosed
	public close() {
		logger.debug('close()');

		this.closed = true;

		this.workers.items.forEach((w) => w.close());
		this.workers.clear();
	}

	@skipIfClosed
	private workerDied(worker: Worker, settings: WorkerSettings): void {
		logger.error('workerDied() restarting... [pid:%d]', worker.pid);

		this.workers.remove(worker);

		(async () => await this.startWorker(settings))().catch((error) => {
			logger.error('workerDied() error restarting [error: %o]', error);
		});
	}

	@skipIfClosed
	private async startWorker(settings: WorkerSettings): Promise<void> {
		const worker = await mediasoup.createWorker(settings);
		const workerData = worker.appData.serverData as WorkerData;

		logger.debug('startWorker() worker started [workerPid: %s]', worker.pid);

		this.workers.add(worker);

		worker.observer.on('newrouter', (router: Router) => {
			router.observer.on('newtransport', (transport: Transport) => {
				transport.observer.on('newconsumer', (consumer: Consumer) => {
					if (!consumer.closed) {
						consumer.observer.once('close', () => workerData.consumers.delete(consumer.id));
						workerData.consumers.set(consumer.id, consumer);
					}
				});
			});
		});

		worker.once('died', () => this.workerDied(worker, settings));
	}

	@skipIfClosed
	public async startWorkers(
		numberOfWorkers = os.cpus().length,
		rtcMinPort = 40000,
		rtcMaxPort = 49999,
	): Promise<void> {
		logger.debug('startWorkers() [numberOfWorkers: %s]', numberOfWorkers);

		for (let i = 0; i < numberOfWorkers; ++i) {
			let settings;

			if (process.env.NODE_ENV === 'development') {
				settings = {
					logLevel: 'debug',
					logTags: [ 'info', 'simulcast', 'bwe', 'score', 'message', 'svc', 'rtx', 'rtp', 'rtcp', 'ice' ],
					rtcMinPort,
					rtcMaxPort,
					appData: {
						serverData: {
							consumers: new Map<string, Consumer>(),
							routersByRoomId: new Map<string, Router>(),
						} as WorkerData
					},
				} as WorkerSettings;
			} else {
				settings = {
					rtcMinPort,
					rtcMaxPort,
					appData: {
						serverData: {
							consumers: new Map<string, Consumer>(),
							routersByRoomId: new Map<string, Router>(),
						} as WorkerData
					},
				} as WorkerSettings;
			}

			await this.startWorker(settings);
		}
	}

	@skipIfClosed
	private async getOrCreateRouter(room: Room, worker: Worker): Promise<Router> {
		logger.debug('getOrCreateRouter() [roomId: %s, workerPid: %s]', room.id, worker.pid);

		const workerData = worker.appData.serverData as WorkerData;

		let router = workerData.routersByRoomId.get(room.id);

		if (!router) {
			// eslint-disable-next-line no-unused-vars
			let audioLevelObserverResolver!: (value: AudioLevelObserver) => void;
			// eslint-disable-next-line no-unused-vars
			let audioLevelObserverRejecter!: (reason?: unknown) => void;

			const audioLevelObserverPromise = new Promise<AudioLevelObserver>((
				resolve,
				reject
			) => {
				audioLevelObserverResolver = resolve;
				audioLevelObserverRejecter = reject;
			});

			const tmpRouter = await worker.createRouter({
				mediaCodecs: [ {
					kind: 'audio',
					mimeType: 'audio/opus',
					clockRate: 48000,
					channels: 2
				}, {
					kind: 'video',
					mimeType: 'video/VP8',
					clockRate: 90000,
					parameters: { 'x-google-start-bitrate': 500 }
				} ],
				appData: {
					serverData: {
						roomId: room.id,
						workerPid: worker.pid,
						pipePromises: new Map<string, Promise<void>>(),
						peers: new Map<string, Peer>(),
						audioLevelObserverPromise
					} as RouterData
				}
			});

			// Has someone created a router meanwhile?
			router = workerData.routersByRoomId.get(room.id);

			if (router) {
				tmpRouter.close();

				return router;
			} else
				router = tmpRouter;

			logger.debug(
				'getOrCreateRouter() new router [roomId: %s, routerId: %s, workerPid: %s]',
				room.id,
				router.id,
				worker.pid
			);

			const audioLevelObserver = await router.createAudioLevelObserver({
				maxEntries: 1,
				threshold: -60,
				interval: 1000
			}).catch((error) => audioLevelObserverRejecter(error));

			if (audioLevelObserver)
				audioLevelObserverResolver(audioLevelObserver);

			workerData.routersByRoomId.set(room.id, router);

			router.observer.once('close', () => {
				logger.debug(
					'getOrCreateRouter() router closed [roomId: %s, routerId: %s, workerId: %s]',
					room.id,
					router?.id,
					worker.pid
				);

				workerData.routersByRoomId.delete(room.id);
			});

			if (!room.parentClosed)
				room.addRouter(router);
			else {
				router.close();
				throw new Error('room closed');
			}

			const { rtpCapabilities } = router;

			rtpCapabilities.headerExtensions = rtpCapabilities.headerExtensions?.filter(
				(ext: RtpHeaderExtension) => ext.uri !== 'urn:3gpp:video-orientation');
		}

		return router;
	}

	@skipIfClosed
	public async getRouter(room: Room): Promise<Router> {
		logger.debug('getRouter() [roomId: %s]', room.id);

		const roomRouters: Router[] = [];

		this.workers.items.forEach(({ appData: { serverData } }) => {
			const r = (serverData as WorkerData).routersByRoomId.get(room.id);

			if (r) roomRouters.push(r);
		});

		// Create a new array, we don't want to mutate the original one
		const leastLoadedWorkers = [ ...this.workers.items ].sort((a, b) =>
			(a.appData.serverData as WorkerData).consumers.size -
			(b.appData.serverData as WorkerData).consumers.size);

		if (roomRouters.length === 0) {
			logger.debug('getRouter() first client [roomId: %s]', room.id);

			return this.getOrCreateRouter(room, leastLoadedWorkers[0]);
		}

		const leastLoadedRoomWorkerPids = roomRouters.map((router) =>
			(router.appData.serverData as RouterData).workerPid);
		const leastLoadedRoomWorkers = leastLoadedWorkers
			.filter((worker) => leastLoadedRoomWorkerPids.includes(worker.pid));

		for (const worker of leastLoadedRoomWorkers) {
			const workerData = worker.appData.serverData as WorkerData;

			if (workerData.consumers.size < 500) {
				logger.debug(
					'getRouter() worker has capacity [roomId: %s, load: %s]',
					room.id,
					workerData.consumers.size
				);

				return this.getOrCreateRouter(room, worker);
			}
		}

		const leastLoadedWorkerData =
			leastLoadedWorkers[0].appData.serverData as WorkerData;

		if (leastLoadedRoomWorkers.length > 0) {
			const leastLoadedRoomWorkerData =
				leastLoadedRoomWorkers[0].appData.serverData as WorkerData;

			if (leastLoadedRoomWorkers[0].pid === leastLoadedWorkers[0].pid) {
				logger.debug(
					'getRouter() room worker least loaded [roomId: %s, load: %s]',
					room.id,
					leastLoadedRoomWorkerData.consumers.size
				);

				return this.getOrCreateRouter(room, leastLoadedRoomWorkers[0]);
			}

			if (
				leastLoadedRoomWorkerData.consumers.size -
				leastLoadedWorkerData.consumers.size < 100
			) {
				logger.debug(
					'getRouter() low delta [roomId: %s, load: %s]',
					room.id,
					leastLoadedRoomWorkerData.consumers.size
				);

				return this.getOrCreateRouter(room, leastLoadedRoomWorkers[0]);
			}
		}

		logger.debug(
			'getRouter() last resort [roomId: %s, load: %s]',
			room.id,
			leastLoadedWorkerData.consumers.size
		);

		return this.getOrCreateRouter(room, leastLoadedWorkers[0]);
	}
}