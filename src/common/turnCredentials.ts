import { createHmac } from 'crypto';

export const getCredentials = (peerId: string, secret: string, validTimeInS: number) => {
	const unixTimeStamp = ~~(Date.now() / 1000) + validTimeInS;
	const username = `${unixTimeStamp}:${peerId}`;
	const hmac = createHmac('sha1', secret);

	hmac.setEncoding('base64');
	hmac.write(username);
	hmac.end();

	return { username, credential: hmac.read() };
};

export const getIceServers = ({ hostname, username, credential }: { hostname:string, username: string, credential: string }) => ([ {
	urls: [ `turns:${hostname}:443?transport=tcp` ],
	username,
	credential
} ]);
