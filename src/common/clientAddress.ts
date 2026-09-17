export interface ConnectionAddress {
	address: string;
	forwardedFor?: string | string[];
}

// The shipped proxy overwrites x-forwarded-for with the PROXY-protocol address,
// so its first entry is the proxy's own view of the client and not a header the
// client could have sent. A proxy that appends instead must be set up the same way.
export const resolveClientIp = ({ address, forwardedFor }: ConnectionAddress): string | undefined => {
	let ip: string | undefined;

	if (forwardedFor) {
		const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

		ip = first?.split(',')[0]?.trim();
	}

	return ip || address || undefined;
};
