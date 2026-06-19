import { List } from 'edumeet-common';
import {
	allPermissions,
	permittedProducer,
	Permission,
	updatePeerPermissions,
} from '../../../src/common/authorization';
import { MediaSourceType } from '../../../src/common/types';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';

const PRESENTER_PERMISSIONS = [
	Permission.SHARE_AUDIO,
	Permission.SHARE_VIDEO,
	Permission.SHARE_SCREEN,
	Permission.SHARE_EXTRA_VIDEO,
	Permission.SEND_CHAT,
];

const peerWith = (permissions: Permission[]) => ({
	permissions,
	hasPermission: (p: Permission) => permissions.includes(p),
}) as unknown as Peer;

const makePeer = (overrides: Record<string, unknown> = {}): Peer => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const peer: any = {
		managedId: 'user1',
		groupIds: [],
		permissions: [] as string[],
		notify: jest.fn(),
		hasPermission: (p: string) => peer.permissions.includes(p),
	};

	Object.assign(peer, overrides);

	return peer as unknown as Peer;
};

const makeRoom = (overrides: Record<string, unknown> = {}): Room => ({
	managedId: 'room1',
	owners: [],
	userRoles: [],
	groupRoles: [],
	defaultRole: undefined,
	lobbyPeers: List<Peer>(),
	promotePeer: jest.fn(),
	...overrides,
}) as unknown as Room;

describe('permittedProducer() - view-only audience cannot publish', () => {
	const sources = [
		MediaSourceType.MIC,
		MediaSourceType.WEBCAM,
		MediaSourceType.SCREEN,
		MediaSourceType.SCREENAUDIO,
		MediaSourceType.EXTRAVIDEO,
		MediaSourceType.EXTRAAUDIO,
	];

	test.each(sources)('Webinar Participant (no SHARE_*) is rejected for %s', (source) => {
		const participant = peerWith([ Permission.SEND_CHAT ]);

		expect(() => permittedProducer(source, {} as Room, participant)).toThrow('peer not authorized');
	});

	test.each(sources)('Presenter is allowed to publish %s', (source) => {
		const presenter = peerWith(PRESENTER_PERMISSIONS);

		expect(() => permittedProducer(source, {} as Room, presenter)).not.toThrow();
	});

	test('Invalid source is rejected', () => {
		const presenter = peerWith(PRESENTER_PERMISSIONS);

		expect(() => permittedProducer('bogus' as MediaSourceType, {} as Room, presenter))
			.toThrow('invalid producer source');
	});
});

describe('updatePeerPermissions() - webinar roles', () => {
	test('Organizer (room owner) receives all permissions', () => {
		const peer = makePeer({ managedId: 'owner1' });
		const room = makeRoom({ managedId: 'room1', owners: [ { userId: 'owner1' } ] });

		updatePeerPermissions(room, peer);

		expect(new Set(peer.permissions)).toEqual(new Set(allPermissions));
	});

	test('Presenter receives exactly the assigned role permissions (no moderation)', () => {
		const peer = makePeer({ managedId: 'pres1' });
		const room = makeRoom({
			managedId: 'room1',
			userRoles: [ {
				userId: 'pres1',
				role: { permissions: PRESENTER_PERMISSIONS.map((name) => ({ name })) },
			} ],
		});

		updatePeerPermissions(room, peer);

		expect(new Set(peer.permissions)).toEqual(new Set(PRESENTER_PERMISSIONS));
		expect(peer.hasPermission(Permission.MODERATE_ROOM)).toBe(false);
	});

	test('Webinar Participant receives only the view-only default role and cannot publish', () => {
		const peer = makePeer({ managedId: 'aud1' });
		const room = makeRoom({
			managedId: 'room1',
			defaultRole: { permissions: [ { name: Permission.SEND_CHAT } ] },
		});

		updatePeerPermissions(room, peer);

		expect(peer.permissions).toEqual([ Permission.SEND_CHAT ]);

		[ Permission.SHARE_AUDIO, Permission.SHARE_VIDEO, Permission.SHARE_SCREEN, Permission.SHARE_EXTRA_VIDEO ]
			.forEach((p) => expect(peer.hasPermission(p)).toBe(false));

		// The computed role must actually block publishing.
		expect(() => permittedProducer(MediaSourceType.MIC, room, peer)).toThrow('peer not authorized');
		expect(() => permittedProducer(MediaSourceType.WEBCAM, room, peer)).toThrow('peer not authorized');
	});
});
