import 'jest';
import { SocketMessage } from 'edumeet-common';
import Room from '../../../src/Room';
import { thisSession } from '../../../src/common/checkSessionId';
    
const createMessage = (id: string|undefined = undefined): SocketMessage => {
	return {
		data: {
			sessionId: id
		}
	} as unknown as SocketMessage;
};

describe('checkSessionId', () => {
	const SESSION_ID1 = 'id1';
	const SESSION_ID2 = 'id2';
	const fakeRoom = {
		sessionId: SESSION_ID1 
	} as unknown as Room;

	it('thisSession() - Should return true on same id', () => {
		const expected = true;
		const actual = thisSession(fakeRoom, createMessage(SESSION_ID1));

		expect(actual).toBe(expected);
	});
    
	it('thisSession() - Should return false on different id', () => {
		const expected = false;
		const actual = thisSession(fakeRoom, createMessage(SESSION_ID2));

		expect(actual).toBe(expected);
	});
	
	it('thisSession() - Should return true on missing sessionId and no room.parent', () => {
		const expected = true;
		const actual = thisSession(fakeRoom, createMessage());

		expect(actual).toBe(expected);
	});
});