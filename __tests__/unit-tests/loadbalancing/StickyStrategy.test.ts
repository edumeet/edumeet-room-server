import { StickyStrategy } from '../../../src/loadbalance/StickyStrategy';
import MediaNode from '../../../src/media/MediaNode';
import Room from '../../../src/Room';

const mediaNode1 = { id: 'id1' } as unknown as MediaNode;
const mediaNode2 = { id: 'id2' } as unknown as MediaNode;
const mediaNode3 = { id: 'id3' } as unknown as MediaNode;

test('Should only return active media-nodes', () => {
	const activeRoomIds = new Set<string>();

	activeRoomIds.add('id1');
	const room = {
		getActiveMediaNodes: jest.fn()
	} as unknown as Room;
	const spyGetActiveMediaNodes = jest.spyOn(room, 'getActiveMediaNodes').mockImplementation(() => {
		return activeRoomIds;
	});

	const sut = new StickyStrategy();
	const mediaNodes: MediaNode[] = [ mediaNode2, mediaNode1 ];

	const candidates =	sut.getCandidates(mediaNodes, room);

	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
	expect(candidates.length).toBe(1);
});

test('Should return all active media-nodes', () => {
	const activeRoomIds = new Set<string>();

	activeRoomIds.add('id3');
	activeRoomIds.add('id2');
	const room = {
		getActiveMediaNodes: jest.fn()
	} as unknown as Room;
	const spyGetActiveMediaNodes = jest.spyOn(room, 'getActiveMediaNodes').mockImplementation(() => {
		return activeRoomIds;
	});

	const sut = new StickyStrategy();
	const mediaNodes: MediaNode[] = [ mediaNode1, mediaNode2, mediaNode3 ];

	const candidates =	sut.getCandidates(mediaNodes, room);

	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
	expect(candidates.length).toBe(2);
});

test('Should return empty array on no active media-nodes', () => {
	const room = {
		getActiveMediaNodes: jest.fn()
	} as unknown as Room;
	const spyGetActiveMediaNodes = jest.spyOn(room, 'getActiveMediaNodes').mockImplementation(() => {
		return new Set<string>();
	});

	const sut = new StickyStrategy();
	const mediaNodes: MediaNode[] = [ mediaNode2, mediaNode1 ];

	const candidates =	sut.getCandidates(mediaNodes, room);

	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
	expect(candidates.length).toBe(0);
});