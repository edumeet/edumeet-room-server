import { roomInfoForMonitoring } from '../../src/common/clientMonitoring';

const room = { id: 'team-sync', sessionId: '0b0f7a52-session', tenantFqdn: 'meet.example.org' };

test('tells a media node nothing about the room by default', () => {
	expect(roomInfoForMonitoring(room, undefined)).toEqual({});
	expect(roomInfoForMonitoring(room, {})).toEqual({});
	expect(roomInfoForMonitoring(room, { roomInfo: false, obfuscateRoomName: true })).toEqual({});
});

test('names the room and the tenant host when room info is on', () => {
	expect(roomInfoForMonitoring(room, { roomInfo: true })).toEqual({
		tenantFqdn: 'meet.example.org',
		roomLabel: 'team-sync',
	});
});

test('labels the room by its session id when room names are to stay off the nodes', () => {
	expect(roomInfoForMonitoring(room, { roomInfo: true, obfuscateRoomName: true })).toEqual({
		tenantFqdn: 'meet.example.org',
		roomLabel: '0b0f7a52-session',
	});
});

test('reads the tenant host as the tenant lookup does: trailing dot dropped, case kept', () => {
	const info = (tenantFqdn: string) => roomInfoForMonitoring({ ...room, tenantFqdn }, { roomInfo: true }).tenantFqdn;

	expect(info('meet.example.org.')).toBe('meet.example.org');
	expect(info('MEET.example.org')).toBe('MEET.example.org');
});

test('leaves the tenant host out when the room has none', () => {
	expect(roomInfoForMonitoring({ id: 'r', sessionId: 's' }, { roomInfo: true })).toEqual({
		tenantFqdn: undefined,
		roomLabel: 'r',
	});
});
