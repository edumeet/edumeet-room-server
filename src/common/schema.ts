import { object, z } from 'zod';
import net from 'net';

const httpSchema = z.union([ z.literal('http'), z.literal('https') ]);
const turnSchema = z.union([ z.literal('turn'), z.literal('turns') ]);
const protocolSchema = z.union([ z.literal('tcp'), z.literal('udp') ]);

const ipString = z.string().refine((val) => net.isIP(val) !== 0, {
	message: 'Invalid IP address (must be IPv4 or IPv6)',
});

export const AppConfigSchema = z.object({
	prometheus: z.object({
		enabled: z.boolean().optional(),
		period: z.number().optional(),
		listener: z.array(z.object({
			ip: ipString,
			port: z.number().int()
				.positive(),
			protocol: httpSchema,
			cert: object({
				key: z.string(),
				cert: z.string()
			}).optional()
		})),
	}).optional(),
	version: z.string().optional(),
	listenPort: z.string()
		.transform((val) => parseInt(val))
		.pipe(z.number().int()
			.positive()),
	listenHost: ipString,
	tls: z.object({
		cert: z.string(),
		key: z.string()
	}).optional(),
	defaultRoomSettings: z.object({
		defaultRole: z.object({
			name: z.string(),
			description: z.string(),
			permissions: z.array(z.object({
				name: z.string()
			}))
		}).optional(),
		locked: z.boolean().optional(),
		maxActiveVideos: z.number().optional(),
		breakoutsEnabled: z.boolean().optional(),
		chatEnabled: z.boolean().optional(),
		filesharingEnabled: z.boolean().optional(),
		raiseHandEnabled: z.boolean().optional(),
		localRecordingEnabled: z.boolean().optional(),
		tracker: z.string().optional(),
		maxFileSize: z.number().int()
			.optional()
	}).optional(),
	managementService: z.object({
		host: z.string(),
		jwtPublicKeys: z.string()
	}).optional(),
	mediaNodes: z.array(z.object(
		{
			hostname: z.string(),
			port: z.number().int()
				.positive(),
			secret: z.string(),
			latitude: z.float64(),
			longitude: z.float64(),
			turnHostname: z.string(),
			turnports: z.array(z.object(
				{
					protocol: turnSchema,
					port: z.number().int()
						.positive(),
					transport: protocolSchema
				}
			))
		}
	))

});
export type AppConfigParsed = z.infer<typeof AppConfigSchema>;
