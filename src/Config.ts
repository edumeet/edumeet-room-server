export interface Config {
	listenHost: string;
	listenPort: string;
	tls?: {
		cert: string;
		key: string;
	};
	mediaNodes: Array<{
		hostname: string;
		port: number;
		secret: string;
		latitude: number;
		longitude: number;
	}>;
	loadBalancingStrategies?: Array<string>;
}