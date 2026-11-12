import 'jest';
import http from 'http';
import { AddressInfo } from 'net';
import CustomMetricsService from '../../src/MetricsService';

// The metrics name every room of every tenant, so the exporter must stay on the address the
// operator configured.
test('the exporter listens on the configured address only', async () => {
	const service = Object.create(CustomMetricsService.prototype) as Record<string, unknown>;

	service.servers = new Map<string, http.Server>();
	service.customMetrics = { contentType: () => 'text/plain', metrics: async () => '' };

	const port = 20000 + Math.floor(Math.random() * 20000);

	// eslint-disable-next-line no-unused-vars
	await (service._createHTTPServer as (ip: string, port: number) => Promise<void>).call(service, '127.0.0.1', port);

	const server = (service.servers as Map<string, http.Server>).get(`127.0.0.1-${port}-http`) as http.Server;

	await new Promise((resolve) => (server.listening ? resolve(undefined) : server.once('listening', resolve)));
	expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
	await new Promise((resolve) => server.close(resolve));
});
