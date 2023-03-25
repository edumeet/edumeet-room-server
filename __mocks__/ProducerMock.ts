import { MediaKind } from 'edumeet-common';
import { EventEmitter } from 'events';

export default class ProducerMock extends EventEmitter {
	id = 'id';
	appData = {
		remoteClosed: false
	};
	kind = MediaKind.VIDEO;

	close = jest.fn();
	resume = jest.fn();
	pause = jest.fn();
}