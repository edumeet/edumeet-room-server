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
	const fakeRoom = {
		sessionId: 'id1' 
	} as unknown as Room;

	it('thisSession() - Should return true on same id', () => {
		expect(thisSession(fakeRoom, createMessage('id1'))).toBe(true);
	});
    
	it('thisSession() - Should return false on different id', () => {
		expect(thisSession(fakeRoom, createMessage('id2'))).toBe(false);
	});
	
	it('thisSession() - Should return true on missing sessionId and no room.parent', () => {
		expect(thisSession(fakeRoom, createMessage())).toBe(true);
	});
});