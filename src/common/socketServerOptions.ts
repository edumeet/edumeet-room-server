import type { ServerOptions } from 'socket.io';
import { RecoveryAdapter } from './recoveryAdapter';

export const socketServerOptions: Partial<ServerOptions> = {
	cors: { origin: '*' },
	cookie: false,
	// The unsent-data limits and session recovery are built around the WebSocket transport, the
	// one the client uses.
	transports: [ 'websocket' ],
	adapter: RecoveryAdapter,
	connectionStateRecovery: {
		// the backup duration of the sessions and the packets
		maxDisconnectionDuration: 5 * 60 * 1000,
		// whether to skip middlewares upon successful recovery
		skipMiddlewares: true,
	}
};
