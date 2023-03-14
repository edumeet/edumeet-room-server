import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeConsumer } from '../media/PipeConsumer';

const logger = new Logger('PipeConsumersMiddleware');

export const createPipeConsumersMiddleware = ({
	routerId,
	pipeConsumers,
}: {
	routerId: string;
	pipeConsumers: Map<string, PipeConsumer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.pipeConsumerId)
			return next();

		const pipeConsumer = pipeConsumers.get(message.data.pipeConsumerId);

		if (!pipeConsumer)
			return next();

		switch (message.method) {
			case 'pipeConsumerClosed': {
				pipeConsumer.close(true);
				context.handled = true;

				break;
			}

			case 'pipeConsumerPaused': {
				pipeConsumer.setProducerPaused();
				context.handled = true;

				break;
			}

			case 'pipeConsumerResumed': {
				pipeConsumer.setProducerResumed();
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