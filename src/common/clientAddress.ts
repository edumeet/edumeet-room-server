import { BlockList, isIP } from 'net';
import { Logger } from 'edumeet-common';
import { getConfig } from '../Config';

const logger = new Logger('clientAddress');

export interface ConnectionAddress {
	address: string;
	forwardedFor?: string | string[];
}

// Loopback and private networks: the shipped nginx proxy reaches the room server over the
// Docker network. A client that connects directly, from outside, comes from a public address.
export const DEFAULT_TRUSTED_PROXIES = [
	'127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10',
];

const unmapped = (address: string): string =>
	((address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4) ? address.slice(7) : address);

let cached: { source?: string[]; list: BlockList } | undefined;

const trustedProxies = (): BlockList => {
	const source = getConfig().trustedProxies;

	if (cached && cached.source === source) return cached.list;

	const list = new BlockList();

	for (const entry of source ?? DEFAULT_TRUSTED_PROXIES) {
		const [ network, bits ] = entry.split('/');
		const version = isIP(network);

		if (!version) {
			logger.warn('trustedProxies: not an address, ignored [entry: %s]', entry);
			continue;
		}

		const type = version === 4 ? 'ipv4' : 'ipv6';

		if (bits === undefined) list.addAddress(network, type);
		else list.addSubnet(network, Number(bits), type);
	}

	cached = { source, list };

	return list;
};

export const isTrustedProxy = (address: string | undefined): boolean => {
	if (!address) return false;

	const ip = unmapped(address);
	const version = isIP(ip);

	return version !== 0 && trustedProxies().check(ip, version === 4 ? 'ipv4' : 'ipv6');
};

// The shipped proxy overwrites x-forwarded-for with the PROXY-protocol address, so its first
// entry is the proxy's own view of the client. It is believed only from a trusted proxy: a
// client that reaches the room server directly could send any header, and a bot credential's
// allowedIps would then check an address of its choice.
export const resolveClientIp = ({ address, forwardedFor }: ConnectionAddress): string | undefined => {
	if (forwardedFor && isTrustedProxy(address)) {
		const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
		const ip = first?.split(',')[0]?.trim();

		if (ip) return ip;
	}

	return address ? unmapped(address) : undefined;
};
