import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Producer } from '../media/Producer';

const logger = new Logger('ProducersMiddleware');

export const createProducersMiddleware = ({
	routerId,
	producers,
}: {
	routerId: string;
	producers: Map<string, Producer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.producerId)
			return next();

		const producer = producers.get(message.data.producerId);

		if (!producer)
			return next();

		switch (message.method) {
			case 'producerClosed': {
				producer.close(true);
				context.handled = true;

				break;
			}

			case 'producerScore': {
				const { score } = message.data;

				producer.setScore(score);
				context.handled = true;

				break;
			}

			default: {
				break;
			}
		}

		return next();
	};

	return middleware;
};