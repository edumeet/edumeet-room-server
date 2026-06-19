import { Next } from 'edumeet-common';
import { createModeratorMiddleware } from '../../../src/middlewares/moderatorMiddleware';
import { Peer, PeerContext } from '../../../src/Peer';
import { Permission } from '../../../src/common/authorization';
import Room from '../../../src/Room';

const SESSION_ID = 'sessionId';
const next = jest.fn as unknown as Next;

const makePeer = (overrides: Record<string, unknown> = {}) => {
	const peer = {
		id: 'peer',
		closed: false,
		permissions: [] as string[],
		hasPermission(p: string) {
			return (this.permissions as string[]).includes(p);
		},
	};

	return Object.assign(peer, overrides);
};

// A host able to present and moderate (can therefore delegate SHARE_* to others).
const makeHost = () => makePeer({
	id: 'host',
	permissions: [
		Permission.MODERATE_ROOM,
		Permission.SHARE_AUDIO,
		Permission.SHARE_VIDEO,
		Permission.SHARE_EXTRA_VIDEO,
	],
});

const buildContext = (peer: unknown, target: Peer, permissions: string[]) => {
	const room = {
		sessionId: SESSION_ID,
		peers: new Map<string, Peer>([ [ 'target', target ] ]),
	} as unknown as Room;

	const context = {
		peer,
		response: {},
		message: {
			method: 'moderator:setPermissions',
			data: {
				sessionId: SESSION_ID,
				updates: [ { peerId: 'target', permissions } ],
			},
		},
	} as unknown as PeerContext;

	return { room, context };
};

test('setPermissions() - host promotes an attendee to presenter (grants SHARE_*)', async () => {
	const host = makeHost();
	const target = makePeer({ id: 'target', permissions: [ Permission.SEND_CHAT ] }) as unknown as Peer;

	const { room, context } = buildContext(host, target, [
		Permission.SHARE_AUDIO,
		Permission.SHARE_VIDEO,
	]);

	await createModeratorMiddleware({ room })(context, next);

	expect(target.permissions).toEqual(
		expect.arrayContaining([ Permission.SHARE_AUDIO, Permission.SHARE_VIDEO ])
	);
	expect(context.handled).toBeTruthy();
});

test('setPermissions() - host demotes a presenter back to view-only (revokes SHARE_*)', async () => {
	const host = makeHost();
	const target = makePeer({ id: 'target', permissions: [ Permission.SHARE_AUDIO ] }) as unknown as Peer;

	// Empty update => remove the SHARE_AUDIO the host is allowed to manage.
	const { room, context } = buildContext(host, target, []);

	await createModeratorMiddleware({ room })(context, next);

	expect(target.permissions).not.toContain(Permission.SHARE_AUDIO);
});

test('setPermissions() - caller cannot grant a permission it does not itself hold', async () => {
	const host = makeHost(); // host has no SHARE_SCREEN
	const target = makePeer({ id: 'target', permissions: [] }) as unknown as Peer;

	const { room, context } = buildContext(host, target, [ Permission.SHARE_SCREEN ]);

	await createModeratorMiddleware({ room })(context, next);

	expect(target.permissions).not.toContain(Permission.SHARE_SCREEN);
});

test('setPermissions() - throws when caller lacks MODERATE_ROOM', async () => {
	const caller = makePeer({ id: 'attendee', permissions: [ Permission.SEND_CHAT ] });
	const target = makePeer({ id: 'target', permissions: [] }) as unknown as Peer;

	const { room, context } = buildContext(caller, target, [ Permission.SHARE_AUDIO ]);

	await expect(createModeratorMiddleware({ room })(context, next)).rejects.toThrow();
});
