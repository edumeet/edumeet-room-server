import { ChatMessage, FileMessage } from './types';

// A room hands its chat and file history to everyone who joins, reconnects or changes
// session, so its size is what each of those costs.
export const MAX_CHAT_HISTORY_MESSAGES = 5000;
export const MAX_CHAT_HISTORY_CHARS = 2_000_000;
export const MAX_FILE_HISTORY = 500;
export const MAX_FILE_HISTORY_PER_PEER = 100;

interface Holder {
	indices: number[]; // of its messages in the history, oldest first
	next: number; // the first of them not dropped yet
	chars: number;
}

/**
 * Adds a message and, over a limit, drops the oldest message of whoever holds most of the
 * history, as often as needed. Dropping the oldest of all would let one participant push out
 * what everyone else wrote with a few hundred long messages. The history is counted once.
 */
export const addChatMessage = (history: ChatMessage[], message: ChatMessage): void => {
	history.push(message);

	const holders = new Map<string, Holder>();
	let chars = 0;

	history.forEach(({ peerId, text }, index) => {
		const holder = holders.get(peerId) ?? { indices: [], next: 0, chars: 0 };

		holder.indices.push(index);
		holder.chars += text.length;
		holders.set(peerId, holder);
		chars += text.length;
	});

	let count = history.length;
	const dropped = new Set<number>();

	while (count > 1 && (count > MAX_CHAT_HISTORY_MESSAGES || chars > MAX_CHAT_HISTORY_CHARS)) {
		const weigh = chars > MAX_CHAT_HISTORY_CHARS
			? (holder: Holder) => holder.chars
			: (holder: Holder) => holder.indices.length - holder.next;
		let largest: Holder | undefined;

		for (const holder of holders.values())
			if (!largest || weigh(holder) > weigh(largest)) largest = holder;

		const index = (largest as Holder).indices[(largest as Holder).next++];
		const length = history[index].text.length;

		(largest as Holder).chars -= length;
		chars -= length;
		count--;
		dropped.add(index);
	}

	if (dropped.size === 0) return;

	let kept = 0;

	for (let index = 0; index < history.length; index++)
		if (!dropped.has(index)) history[kept++] = history[index];

	history.length = kept;
};

/**
 * Whether one more file of this peer fits. A full history refuses new files and drops
 * none: clients go on showing a file the server forgot, no one could clear it any more,
 * and another peer could share it again as its own.
 */
export const hasRoomForFile = (history: FileMessage[], peerId: string): boolean =>
	history.length < MAX_FILE_HISTORY && history.filter((item) => item.peerId === peerId).length < MAX_FILE_HISTORY_PER_PEER;
