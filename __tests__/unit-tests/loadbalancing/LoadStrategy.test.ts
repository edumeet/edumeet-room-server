import LoadStrategy from '../../../src/loadbalancing/LoadStrategy';
import MediaNode from '../../../src/media/MediaNode';

test('Should use other media-node on high load', () => {
	const node1 = { load: 0.86 } as unknown as MediaNode;
	const node2 = { load: 0 } as unknown as MediaNode;

	const sut = new LoadStrategy();

	const candidates = sut.getCandidates([ node1, node2 ]);

	expect(candidates[0]).toBe(node2);
	expect(candidates.length).toBe(1);
});

test('Should return sorted on load on no candidates', () => {
	const node1 = { load: 0.3 } as unknown as MediaNode;
	const node2 = { load: 0.1 } as unknown as MediaNode;
	const node3 = { load: 0.6 } as unknown as MediaNode;

	const sut = new LoadStrategy();

	const candidates = sut.getCandidates([ node1, node3, node2 ]);

	expect(candidates[0]).toBe(node2);
	expect(candidates[1]).toBe(node1);
	expect(candidates[2]).toBe(node3);
	expect(candidates.length).toBe(3);
});

test('Should filter out high load candidates', () => {
	const node1 = { load: 0.2 } as unknown as MediaNode;
	const node2 = { load: 0.87 } as unknown as MediaNode;
	const node3 = { load: 0.9 } as unknown as MediaNode;

	const sut = new LoadStrategy();

	const candidates = sut.getCandidates([ node3, node2, node1 ]);

	expect(candidates[0]).toBe(node1);
	expect(candidates.length).toBe(1);
});

test('Should return empty array on all node high load ', () => {
	const node1 = { load: 0.92 } as unknown as MediaNode;
	const node2 = { load: 0.87 } as unknown as MediaNode;

	const sut = new LoadStrategy();

	const candidates = sut.getCandidates([ node1, node2 ]);

	expect(candidates.length).toBe(0);
});