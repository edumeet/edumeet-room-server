import { EventEmitter } from 'events';

export default class ProducerMock extends EventEmitter {
	id = 'id';
	appData = {
		remoteClosed: false
	};

	close = jest.fn();
	resume = jest.fn();
	pause = jest.fn();
}