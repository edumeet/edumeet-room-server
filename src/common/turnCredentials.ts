import { createHmac } from 'crypto';

export interface IceCredentials {
	username: string;
	credential: string;
}

export interface IceServerConfig extends IceCredentials {
	hostname: string;
}

export interface IceServer {
	urls: string[];
	username: string;
	credential: string;
}

export const getCredentials = (peerId: string, secret: string, validTimeInS: number): IceCredentials => {
	const unixTimeStamp = ~~(Date.now() / 1000) + validTimeInS;
	const username = `${unixTimeStamp}:${peerId}`;
	const hmac = createHmac('sha1', secret);

	hmac.setEncoding('base64');
	hmac.write(username);
	hmac.end();

	return { username, credential: hmac.read() };
};

export const getIceServers = ({ hostname, username, credential }: IceServerConfig): IceServer[] => ([ {
	urls: [ `turn:${hostname}:3478?transport=udp`, `turns:${hostname}:443?transport=tcp` ],
	username,
	credential
} ]);
