import net from 'net';
import dgram from 'dgram';

type Protocol = 'tcp' | 'udp';

/**
 * Returns true if the port on the given host/interface can be bound
 * for the specified protocol (TCP or UDP).
 *
 * @param port Port number
 * @param host IP or hostname (IPv4 or IPv6)
 * @param protocol "tcp" or "udp"
 */
export async function canUsePort(
	port: number,
	host: string = '0.0.0.0',
	protocol: Protocol = 'tcp'
): Promise<boolean> {
	return new Promise((resolve) => {
		if (port >= 0 && port < 65536) {
			if (protocol === 'tcp') {
				const tester = net
					.createServer()
					.once('error', () => resolve(false))
					.once('listening', () => {
						tester.close(() => resolve(true));
					})
					.listen({ port, host });
			} else {
				const socket = dgram.createSocket(
					host.includes(':') ? 'udp6' : 'udp4'
				);

				socket.once('error', () => {
					socket.close();
					resolve(false);
				});
				socket.bind(port, host, () => {
					socket.close();
					resolve(true);
				});
			}
		} else {
			resolve(false);
		}
	});
}