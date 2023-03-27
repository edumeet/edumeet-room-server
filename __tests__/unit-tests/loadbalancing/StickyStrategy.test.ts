import { KDPoint } from 'edumeet-common';
import StickyStrategy from '../../../src/loadbalancing/StickyStrategy';
import MediaNode from '../../../src/media/MediaNode';
import Room from '../../../src/Room';

const mediaNode1 = { id: 'id1' } as unknown as MediaNode;
const mediaNode2 = { id: 'id2' } as unknown as MediaNode;

test('Should only return active media-nodes', () => {
	const point1 = { appData: {
		mediaNode: mediaNode1
	} } as unknown as KDPoint;

	const room = {
		getActiveMediaNodes: jest.fn()
	} as unknown as Room;
	const spyGetActiveMediaNodes = jest.spyOn(room, 'getActiveMediaNodes').mockReturnValue([ point1 ]);

	const sut = new StickyStrategy();
	const candidates =	sut.getCandidates(room);

	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
	expect(candidates.length).toBe(1);
	expect(candidates[0]).toBe(point1);
});

test('Should return multiple active media-nodes', () => {
	const point1 = { appData: {
		mediaNode: mediaNode1
	} } as unknown as KDPoint;
	const point2 = { appData: {
		mediaNode: mediaNode2
	} } as unknown as KDPoint;
	const room = {
		getActiveMediaNodes: jest.fn()
	} as unknown as Room;
	const spyGetActiveMediaNodes = jest.spyOn(room, 'getActiveMediaNodes').mockReturnValue([ point2, point1 ]);

	const sut = new StickyStrategy();

	const candidates =	sut.getCandidates(room);

	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
	expect(candidates.length).toBe(2);
	expect(candidates[0]).toBe(point2);
	expect(candidates[1]).toBe(point1);
});

test('Should return empty array on no active media-nodes', () => {
	const room = {
		getActiveMediaNodes: jest.fn()
	} as unknown as Room;
	const spyGetActiveMediaNodes = jest.spyOn(room, 'getActiveMediaNodes').mockReturnValue([]);

	const sut = new StickyStrategy();

	const candidates =	sut.getCandidates(room);

	expect(spyGetActiveMediaNodes).toHaveBeenCalled();
	expect(candidates.length).toBe(0);
});