import { createHmac } from 'crypto';

export interface IceCredentials {
	username: string;
	credential: string;
}

export interface IceServerConfig extends IceCredentials {
	hostname: string;
	turnports: Array<{
		protocol: string; // turn / turns
		port: number;
		transport: string;
	}>
}

export interface IceServer {
	urls: string[];
	username: string;
	credential: string;
}

export const getCredentials = (peerId: string, secret: string, validTimeInS: number): IceCredentials => {
	const unixTimeStamp = ~~(Date.now() / 1000) + validTimeInS;
	const username = `${unixTimeStamp}:${peerId}`;
	const hmac = createHmac('sha256', secret);

	hmac.setEncoding('base64');
	hmac.write(username);
	hmac.end();

	return { username, credential: hmac.read() };
};

export const getIceServers = ({ hostname, username, credential, turnports }: IceServerConfig): IceServer[] => {
	const urls = turnports.map((turnport) =>
		`${turnport.protocol}:${hostname}:${turnport.port}?transport=${turnport.transport}`
	);

	return [
		{
			urls,
			username,
			credential
		}
	];
};
