import { Logger } from '../common/logger';
import { Middleware } from '../common/middleware';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Producer } from '../media/Producer';

const logger = new Logger('ProducerMiddleware');

export const createProducerMiddleware = ({
	producer,
}: { producer: Producer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createProducerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			producer.router.id === message.data.routerId &&
			producer.id === message.data.producerId
		) {
			switch (message.method) {
				case 'producerPaused': {
					producer.paused = true;
					context.handled = true;

					break;
				}

				case 'producerResumed': {
					producer.paused = false;
					context.handled = true;

					break;
				}

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
		}

		return next();
	};

	return middleware;
};