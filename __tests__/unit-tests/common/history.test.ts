import 'jest';
import { ChatMessage, FileMessage } from '../../../src/common/types';
import {
	addChatMessage,
	hasRoomForFile,
	MAX_CHAT_HISTORY_CHARS,
	MAX_CHAT_HISTORY_MESSAGES,
	MAX_FILE_HISTORY,
	MAX_FILE_HISTORY_PER_PEER
} from '../../../src/common/history';
import { MAX_CHAT_MESSAGE_LENGTH } from '../../../src/common/textValidation';

const message = (text: string, peerId = 'p') => ({ text, peerId }) as unknown as ChatMessage;

// The history goes to everyone who joins, reconnects or changes session.
describe('chat and file history', () => {
	test('keeps the newest messages up to the maximum number', () => {
		const history: ChatMessage[] = [];

		for (let i = 0; i < MAX_CHAT_HISTORY_MESSAGES + 10; i++) addChatMessage(history, message(String(i)));

		expect(history).toHaveLength(MAX_CHAT_HISTORY_MESSAGES);
		expect(history[0].text).toBe('10');
		expect(history[history.length - 1].text).toBe(String(MAX_CHAT_HISTORY_MESSAGES + 9));
	});

	test('keeps the text of all messages under the maximum, however long each is', () => {
		const history: ChatMessage[] = [];
		const long = 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH);

		for (let i = 0; i < 2 * MAX_CHAT_HISTORY_CHARS / MAX_CHAT_MESSAGE_LENGTH; i++) addChatMessage(history, message(long));

		expect(history.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(MAX_CHAT_HISTORY_CHARS);
		expect(history).toHaveLength(MAX_CHAT_HISTORY_CHARS / MAX_CHAT_MESSAGE_LENGTH);
	});

	test('changes the room\'s own list, which others hold', () => {
		const history: ChatMessage[] = [];
		const same = history;

		addChatMessage(history, message('a'));
		expect(same).toHaveLength(1);
	});

	test('drops the messages of whoever fills the history, not what the others wrote', () => {
		const history: ChatMessage[] = [];
		const long = 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH);

		for (let i = 0; i < 50; i++) addChatMessage(history, message(`said ${i}`, `other-${i % 5}`));
		for (let i = 0; i < 3 * MAX_CHAT_HISTORY_CHARS / MAX_CHAT_MESSAGE_LENGTH; i++) addChatMessage(history, message(long, 'flood'));

		expect(history.filter((item) => item.peerId !== 'flood')).toHaveLength(50);
		expect(history.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(MAX_CHAT_HISTORY_CHARS);

		const counted: ChatMessage[] = [];

		for (let i = 0; i < 50; i++) addChatMessage(counted, message(`said ${i}`, `other-${i % 5}`));
		for (let i = 0; i < MAX_CHAT_HISTORY_MESSAGES + 100; i++) addChatMessage(counted, message('x', 'flood'));

		expect(counted).toHaveLength(MAX_CHAT_HISTORY_MESSAGES);
		expect(counted.filter((item) => item.peerId !== 'flood')).toHaveLength(50);
	});

	test('a full file history takes no more files, of one peer or of all', () => {
		const file = (peerId: string) => ({ magnetURI: 'magnet:?xt=urn:btih:0', peerId }) as unknown as FileMessage;
		const history: FileMessage[] = [];

		for (let i = 0; i < MAX_FILE_HISTORY_PER_PEER; i++) history.push(file('a'));
		expect(hasRoomForFile(history, 'a')).toBe(false);
		expect(hasRoomForFile(history, 'b')).toBe(true);

		for (let i = history.length; i < MAX_FILE_HISTORY; i++) history.push(file(`p-${i % 50}`));
		expect(hasRoomForFile(history, 'b')).toBe(false);
	});
});

test('one message that drops thousands of small ones is quick, and drops the right ones', () => {
	const history: ChatMessage[] = [];
	const long = 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH);

	for (let i = 0; i < 4800; i++) history.push(message('s', 'flood'));
	for (let i = 0; i < 199; i++) history.push(message(long, 'flood'));
	history.push(message('kept', 'other'));

	const started = Date.now();

	addChatMessage(history, message(long, 'flood'));

	expect(Date.now() - started).toBeLessThan(100);
	expect(history.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(MAX_CHAT_HISTORY_CHARS);
	expect(history.filter((item) => item.peerId === 'other')).toHaveLength(1);
	expect(history.filter((item) => item.text === 's').length).toBeLessThan(4800);
	expect(history[history.length - 1].text).toBe(long);
});
