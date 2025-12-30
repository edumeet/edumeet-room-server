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

export const getCredentials = (peerId: string, secret: string, validTimeInS: number) => {
	const unixTimeStamp = Math.floor(Date.now() / 1000) + validTimeInS;
	const username = `${unixTimeStamp}:${peerId}`;
	const credential = createHmac('sha1', secret).update(username).digest('base64');

	return { username, credential };
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
