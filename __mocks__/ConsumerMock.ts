export default class ConsumerMock {
	id = 'id';

	resume = jest.fn();
	pause = jest.fn();
	setPreferredLayers = jest.fn();
	setPriority = jest.fn();
	requestKeyFrame = jest.fn();
}