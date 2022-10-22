import os from 'os';
import path from 'path';
import repl from 'repl';
import readline from 'readline';
import net from 'net';
import fs from 'fs';
import * as mediasoup from 'mediasoup';
import { Worker, WorkerLogLevel, WorkerLogTag } from 'mediasoup/node/lib/Worker';
import { WebRtcServer } from 'mediasoup/node/lib/WebRtcServer';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import { DataProducer } from 'mediasoup/node/lib/DataProducer';
import { DataConsumer } from 'mediasoup/node/lib/DataConsumer';
import { Logger } from './common/logger';
import ServerManager from './ServerManager';

const SOCKET_PATH_UNIX = '/tmp/edumeet-room-server.sock';
const SOCKET_PATH_WIN = path.join('\\\\?\\pipe', process.cwd(), 'edumeet-room-server');
const SOCKET_PATH = os.platform() === 'win32' ? SOCKET_PATH_WIN : SOCKET_PATH_UNIX;

const workers = new Map<number, Worker>();
const webRtcServers = new Map<string, WebRtcServer>();
const routers = new Map<string, Router>();
const transports = new Map<string, Transport>();
const producers = new Map<string, Producer>();
const consumers = new Map<string, Consumer>();
const dataProducers = new Map<string, DataProducer>();
const dataConsumers = new Map<string, DataConsumer>();

const logger = new Logger('InteractiveServer');

class InteractiveServer {
	private socket: net.Socket;
	private isTerminalOpen = false;

	constructor(socket: net.Socket) {
		this.socket = socket;
	}

	public openCommandConsole(): void {
		this.log('\n[opening Readline Command Console...]');
		this.log('type help to print available commands');

		const cmd = readline.createInterface({
			input: this.socket,
			output: this.socket,
			terminal: true
		});

		cmd.on('close', () => {
			if (this.isTerminalOpen) return;

			this.log('\nExiting...');

			this.socket.end();
		});

		const readStdin = (): void => {
			cmd.question('cmd> ', async (input) => {
				const params = input.split(/[\s\t]+/);
				const command = params.shift();

				switch (command) {
					case '': {
						readStdin();
						break;
					}

					case 'h':
					case 'help': {
						this.log('');
						this.log('available commands:');
						this.log('- h,  help                    : show this message');
						this.log('- logLevel level              : changes logLevel in all mediasoup Workers');
						this.log('- logTags [tag] [tag]         : changes logTags in all mediasoup Workers (values separated by space)');
						this.log('- dw, dumpWorkers             : dump mediasoup Workers');
						this.log('- dwrs, dumpWebRtcServer [id] : dump mediasoup WebRtcServer with given id (or the latest created one)');
						this.log('- dr, dumpRouter [id]         : dump mediasoup Router with given id (or the latest created one)');
						this.log('- dt, dumpTransport [id]      : dump mediasoup Transport with given id (or the latest created one)');
						this.log('- dp, dumpProducer [id]       : dump mediasoup Producer with given id (or the latest created one)');
						this.log('- dc, dumpConsumer [id]       : dump mediasoup Consumer with given id (or the latest created one)');
						this.log('- ddp, dumpDataProducer [id]  : dump mediasoup DataProducer with given id (or the latest created one)');
						this.log('- ddc, dumpDataConsumer [id]  : dump mediasoup DataConsumer with given id (or the latest created one)');
						this.log('- st, statsTransport [id]     : get stats for mediasoup Transport with given id (or the latest created one)');
						this.log('- sp, statsProducer [id]      : get stats for mediasoup Producer with given id (or the latest created one)');
						this.log('- sc, statsConsumer [id]      : get stats for mediasoup Consumer with given id (or the latest created one)');
						this.log('- sdp, statsDataProducer [id] : get stats for mediasoup DataProducer with given id (or the latest created one)');
						this.log('- sdc, statsDataConsumer [id] : get stats for mediasoup DataConsumer with given id (or the latest created one)');
						this.log('- t,  terminal                : open Node REPL Terminal');
						this.log('');
						readStdin();

						break;
					}

					case 'logLevel': {
						const level = params[0];
						const promises = [];

						for (const worker of workers.values()) {
							promises.push(worker.updateSettings({ logLevel: level as WorkerLogLevel }));
						}

						try {
							await Promise.all(promises);

							this.log('done');
						} catch (error) {
							this.error(String(error));
						}

						break;
					}

					case 'logTags': {
						const tags = params;
						const promises = [];

						for (const worker of workers.values()) {
							promises.push(worker.updateSettings({ logTags: tags as WorkerLogTag[] }));
						}

						try {
							await Promise.all(promises);

							this.log('done');
						} catch (error) {
							this.error(String(error));
						}

						break;
					}

					case 'dw':
					case 'dumpWorkers': {
						for (const worker of workers.values()) {
							try {
								const dump = await worker.dump();

								this.log(`worker.dump():\n${JSON.stringify(dump, null, '  ')}`);
							} catch (error) {
								this.error(`worker.dump() failed: ${error}`);
							}
						}

						break;
					}

					case 'dwrs':
					case 'dumpWebRtcServer': {
						const id = params[0] || Array.from(webRtcServers.keys()).pop();

						if (!id) {
							this.error('no WebRtcServer found');

							break;
						}

						const webRtcServer = webRtcServers.get(id);

						if (!webRtcServer) {
							this.error('WebRtcServer not found');

							break;
						}

						try {
							const dump = await webRtcServer.dump();

							this.log(`webRtcServer.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`webRtcServer.dump() failed: ${error}`);
						}

						break;
					}

					case 'dr':
					case 'dumpRouter': {
						const id = params[0] || Array.from(routers.keys()).pop();

						if (!id) {
							this.error('no Router found');

							break;
						}

						const router = routers.get(id);

						if (!router) {
							this.error('Router not found');

							break;
						}

						try {
							const dump = await router.dump();

							this.log(`router.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`router.dump() failed: ${error}`);
						}

						break;
					}

					case 'dt':
					case 'dumpTransport': {
						const id = params[0] || Array.from(transports.keys()).pop();

						if (!id) {
							this.error('no Transport found');

							break;
						}

						const transport = transports.get(id);

						if (!transport) {
							this.error('Transport not found');

							break;
						}

						try {
							const dump = await transport.dump();

							this.log(`transport.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`transport.dump() failed: ${error}`);
						}

						break;
					}

					case 'dp':
					case 'dumpProducer': {
						const id = params[0] || Array.from(producers.keys()).pop();

						if (!id) {
							this.error('no Producer found');

							break;
						}

						const producer = producers.get(id);

						if (!producer) {
							this.error('Producer not found');

							break;
						}

						try {
							const dump = await producer.dump();

							this.log(`producer.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`producer.dump() failed: ${error}`);
						}

						break;
					}

					case 'dc':
					case 'dumpConsumer': {
						const id = params[0] || Array.from(consumers.keys()).pop();

						if (!id) {
							this.error('no Consumer found');

							break;
						}

						const consumer = consumers.get(id);

						if (!consumer) {
							this.error('Consumer not found');

							break;
						}

						try {
							const dump = await consumer.dump();

							this.log(`consumer.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`consumer.dump() failed: ${error}`);
						}

						break;
					}

					case 'ddp':
					case 'dumpDataProducer': {
						const id = params[0] || Array.from(dataProducers.keys()).pop();

						if (!id) {
							this.error('no DataProducer found');

							break;
						}

						const dataProducer = dataProducers.get(id);

						if (!dataProducer) {
							this.error('DataProducer not found');

							break;
						}

						try {
							const dump = await dataProducer.dump();

							this.log(`dataProducer.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`dataProducer.dump() failed: ${error}`);
						}

						break;
					}

					case 'ddc':
					case 'dumpDataConsumer': {
						const id = params[0] || Array.from(dataConsumers.keys()).pop();

						if (!id) {
							this.error('no DataConsumer found');

							break;
						}

						const dataConsumer = dataConsumers.get(id);

						if (!dataConsumer) {
							this.error('DataConsumer not found');

							break;
						}

						try {
							const dump = await dataConsumer.dump();

							this.log(`dataConsumer.dump():\n${JSON.stringify(dump, null, '  ')}`);
						} catch (error) {
							this.error(`dataConsumer.dump() failed: ${error}`);
						}

						break;
					}

					case 'st':
					case 'statsTransport': {
						const id = params[0] || Array.from(transports.keys()).pop();

						if (!id) {
							this.error('no Transport found');

							break;
						}

						const transport = transports.get(id);

						if (!transport) {
							this.error('Transport not found');

							break;
						}

						try {
							const stats = await transport.getStats();

							this.log(`transport.getStats():\n${JSON.stringify(stats, null, '  ')}`);
						} catch (error) {
							this.error(`transport.getStats() failed: ${error}`);
						}

						break;
					}

					case 'sp':
					case 'statsProducer': {
						const id = params[0] || Array.from(producers.keys()).pop();

						if (!id) {
							this.error('no Producer found');

							break;
						}

						const producer = producers.get(id);

						if (!producer) {
							this.error('Producer not found');

							break;
						}

						try {
							const stats = await producer.getStats();

							this.log(`producer.getStats():\n${JSON.stringify(stats, null, '  ')}`);
						} catch (error) {
							this.error(`producer.getStats() failed: ${error}`);
						}

						break;
					}

					case 'sc':
					case 'statsConsumer': {
						const id = params[0] || Array.from(consumers.keys()).pop();

						if (!id) {
							this.error('no Consumer found');

							break;
						}

						const consumer = consumers.get(id);

						if (!consumer) {
							this.error('Consumer not found');

							break;
						}

						try {
							const stats = await consumer.getStats();

							this.log(`consumer.getStats():\n${JSON.stringify(stats, null, '  ')}`);
						} catch (error) {
							this.error(`consumer.getStats() failed: ${error}`);
						}

						break;
					}

					case 'sdp':
					case 'statsDataProducer': {
						const id = params[0] || Array.from(dataProducers.keys()).pop();

						if (!id) {
							this.error('no DataProducer found');

							break;
						}

						const dataProducer = dataProducers.get(id);

						if (!dataProducer) {
							this.error('DataProducer not found');

							break;
						}

						try {
							const stats = await dataProducer.getStats();

							this.log(`dataProducer.getStats():\n${JSON.stringify(stats, null, '  ')}`);
						} catch (error) {
							this.error(`dataProducer.getStats() failed: ${error}`);
						}

						break;
					}

					case 'sdc':
					case 'statsDataConsumer': {
						const id = params[0] || Array.from(dataConsumers.keys()).pop();

						if (!id) {
							this.error('no DataConsumer found');

							break;
						}

						const dataConsumer = dataConsumers.get(id);

						if (!dataConsumer) {
							this.error('DataConsumer not found');

							break;
						}

						try {
							const stats = await dataConsumer.getStats();

							this.log(`dataConsumer.getStats():\n${JSON.stringify(stats, null, '  ')}`);
						} catch (error) {
							this.error(`dataConsumer.getStats() failed: ${error}`);
						}

						break;
					}

					case 't':
					case 'terminal': {
						this.isTerminalOpen = true;

						cmd.close();
						this.openTerminal();

						return;
					}

					default: {
						this.error(`unknown command '${command}'`);
						this.log('press \'h\' or \'help\' to get the list of available commands');
					}
				}

				readStdin();
			});
		};

		readStdin();
	}

	private openTerminal(): void {
		this.log('\n[opening Node REPL Terminal...]');
		this.log('here you have access to workers, webRtcServers, routers, transports, producers, consumers, dataProducers and dataConsumers ES6 maps');

		const terminal = repl.start({
			input: this.socket,
			output: this.socket,
			terminal: true,
			prompt: 'terminal> ',
			useColors: true,
			useGlobal: true,
			ignoreUndefined: false,
			preview: false
		});

		this.isTerminalOpen = true;

		terminal.on('exit', () => {
			this.log('\n[exiting Node REPL Terminal...]');

			this.isTerminalOpen = false;

			this.openCommandConsole();
		});
	}

	private log(msg: string): void {
		this.socket.write(`${msg}\n`);
	}

	private error(msg: string): void {
		this.socket.write(`ERROR: ${msg}\n`);
	}
}

const runMediasoupObserver = () => {
	mediasoup.observer.on('newworker', (worker) => {
		workers.set(worker.pid, worker);
		worker.observer.once('close', () => workers.delete(worker.pid));

		worker.observer.on('newwebrtcserver', (webRtcServer) => {
			webRtcServers.set(webRtcServer.id, webRtcServer);
			webRtcServer.observer.once('close', () => webRtcServers.delete(webRtcServer.id));
		});

		worker.observer.on('newrouter', (router) => {
			routers.set(router.id, router);
			router.observer.once('close', () => routers.delete(router.id));

			router.observer.on('newtransport', (transport) => {
				transports.set(transport.id, transport);
				transport.observer.once('close', () => transports.delete(transport.id));

				transport.observer.on('newproducer', (producer) => {
					producers.set(producer.id, producer);
					producer.observer.once('close', () => producers.delete(producer.id));
				});

				transport.observer.on('newconsumer', (consumer) => {
					consumers.set(consumer.id, consumer);
					consumer.observer.once('close', () => consumers.delete(consumer.id));
				});

				transport.observer.on('newdataproducer', (dataProducer) => {
					dataProducers.set(dataProducer.id, dataProducer);
					dataProducer.observer.once('close', () => dataProducers.delete(dataProducer.id));
				});

				transport.observer.on('newdataconsumer', (dataConsumer) => {
					dataConsumers.set(dataConsumer.id, dataConsumer);
					dataConsumer.observer.once('close', () => dataConsumers.delete(dataConsumer.id));
				});
			});
		});
	});
};

export const interactiveServer = (serverManager: ServerManager) => {
	runMediasoupObserver();

	global.serverManager = serverManager;
	global.workers = workers;
	global.routers = routers;
	global.transports = transports;
	global.producers = producers;
	global.consumers = consumers;
	global.dataProducers = dataProducers;
	global.dataConsumers = dataConsumers;

	const server = net.createServer((socket) => {
		const interactive = new InteractiveServer(socket);

		interactive.openCommandConsole();
	});

	try {
		fs.unlinkSync(SOCKET_PATH);
	} catch (error) {}

	server.listen(SOCKET_PATH, () => {
		logger.debug('InteractiveServer listening [socket: %s}', SOCKET_PATH);
	});
};