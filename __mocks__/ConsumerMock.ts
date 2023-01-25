export default class ProducerMock {
	id = 'id';

	resume = jest.fn();
	pause = jest.fn();
	setPreferredLayers = jest.fn();
	setPriority = jest.fn();
	requestKeyFrame = jest.fn();
}