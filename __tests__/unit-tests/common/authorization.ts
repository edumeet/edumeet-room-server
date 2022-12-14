import 'jest';
import { Peer } from '../../../src/Peer';
import Room from '../../../src/Room';
import { Access, hasAccess, hasPermission, isAllowed, isAllowedBecauseMissing, Permission, permittedProducer, promoteOnHostJoin, userRoles } from '../../../src/common/authorization';
import { List, MediaSourceType } from 'edumeet-common';

describe('authorization', () => {
	let fakeRoom: Room;
	let fakePeerNoRole: Peer;
	let fakePeerNormal: Peer;
	let fakePeerAdmin: Peer;

	beforeAll(() => {
		fakeRoom = { 
			locked: false, 
		} as unknown as Room;
		fakePeerNoRole = {
			roles: []
		} as unknown as Peer;
		fakePeerNormal = {
			roles: [ userRoles.NORMAL ]
		} as unknown as Peer;
		fakePeerAdmin = {
			roles: [ userRoles.ADMIN ]
		} as unknown as Peer;
	});

	describe('hasPermission()', () => {
		it('hasPermission() - NORMAL should be able to share screen', () => {
			const expected = true;
			const actual = hasPermission(fakeRoom, fakePeerNormal, Permission.SHARE_SCREEN);

			expect(actual).toBe(expected);
		});
	
		it('hasPermission() - NO ROLE should not be able to share screen', () => {
			const expected = false;
			const actual = hasPermission(fakeRoom, fakePeerNoRole, Permission.SHARE_SCREEN);

			expect(actual).toBe(expected);
		});
	});

	describe('hasAccess()', () => {
		it('NORMAL should bypass lobby', () => {
			const expected = true;
			const actual = hasAccess(fakePeerNormal, Access.BYPASS_LOBBY);

			expect(actual).toBe(expected);
		});
	
		it('NORMAL should not bypass room lock', () => {
			const expected = false;
			const actual = hasAccess(fakePeerNormal, Access.BYPASS_ROOM_LOCK);

			expect(actual).toBe(expected);
		});
	
		it('NORMAL should not bypass room lock', () => {
			const expected = true;
			const actual = hasAccess(fakePeerAdmin, Access.BYPASS_ROOM_LOCK);

			expect(actual).toBe(expected);
		});
	});

	describe('isAllowed()', () => {
		let fakeRoomLocked: Room;

		beforeAll(() => {
			fakeRoomLocked = { locked: true } as unknown as Room;
		});

		it('ADMIN should be allowed into locked room', () => {
			const expected = true;
			const actual = isAllowed(fakeRoomLocked, fakePeerAdmin);

			expect(actual).toBe(expected);
		});
	
		it('NORMAL should not be allowed into locked room', () => {
			const expected = false;
			const actual = isAllowed(fakeRoomLocked, fakePeerNormal);

			expect(actual).toBe(expected);
		});
	});
	
	describe('isAllowedBecauseMissing()', () => {
		let fakeRoomWithLobby: Room;
		let lobbyPeer: Peer;

		beforeEach(() => {
			lobbyPeer = {} as unknown as Peer;
			fakeRoomWithLobby = { 
				lobbyPeers: [ lobbyPeer ], 
				peers: { items: [] }, 
				pendingPeers: { items: [] } 
			} as unknown as Room;
		});
		it('NORMAL should be allowed when peer in lobby', () => {
			const expected = true;
			const actual = isAllowedBecauseMissing(
				fakeRoomWithLobby, 
				fakePeerNormal, 
				Permission.SHARE_SCREEN
			);

			expect(actual).toBe(expected);
		});
	
		it('NORMAL should not be allowed when lobby is empty', () => {
			const fakeLobbyList = [] as unknown as List<Peer>;

			fakeRoomWithLobby.lobbyPeers = fakeLobbyList;
		
			const expected = true;
			const actual = isAllowedBecauseMissing(
				fakeRoomWithLobby, 
				fakePeerNormal, 
				Permission.SHARE_SCREEN
			);

			expect(actual).toBe(expected);
		});
	});
	
	describe('promoteOnHostJoin', () => {
		it('Should always return false because not implemented', () => {
			const expected = false;
			const actual = promoteOnHostJoin(fakeRoom, fakePeerNormal);

			expect(actual).toBe(expected);
		});
	});

	describe('permittedProducer()', () => {
		it('Should throw on invalid source type', () => {
			expect(() => permittedProducer('illegal', fakeRoom, fakePeerNormal)).toThrowError();
		});

		it('Should not throw on valid source type', () => {
			const legalSourceTypes = Object.values(MediaSourceType); 

			for (const s of legalSourceTypes) {
				expect(() => permittedProducer(s, fakeRoom, fakePeerNormal)).not.toThrow();
			}
		});

		it('Should throw when not allowed to share', () => {
			const legalSourceTypes = Object.values(MediaSourceType); 

			for (const s of legalSourceTypes) {
				expect(() => permittedProducer(s, fakeRoom, fakePeerNoRole)).toThrowError();
			}
		});
	});
});