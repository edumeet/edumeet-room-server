import os from 'os';
import path from 'path';
import repl from 'repl';
import readline from 'readline';
import net from 'net';
import fs from 'fs';
import ServerManager from './ServerManager';
import { Logger } from 'edumeet-common';
import ManagementService from './ManagementService';

const SOCKET_PATH_UNIX = '/tmp/edumeet-room-server.sock';
const SOCKET_PATH_WIN = path.join('\\\\?\\pipe', process.cwd(), 'edumeet-room-server');
const SOCKET_PATH = os.platform() === 'win32' ? SOCKET_PATH_WIN : SOCKET_PATH_UNIX;

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
						this.log('- t,  terminal                : open Node REPL Terminal');
						this.log('');
						readStdin();

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

export const interactiveServer = (serverManager: ServerManager, managementService: ManagementService) => {
	global.serverManager = serverManager;
	global.managementService = managementService;

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