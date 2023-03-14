import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeDataConsumer } from '../media/PipeDataConsumer';

const logger = new Logger('PipeDataConsumersMiddleware');

export const createPipeDataConsumersMiddleware = ({
	routerId,
	pipeDataConsumers,
}: {
	routerId: string;
	pipeDataConsumers: Map<string, PipeDataConsumer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeDataConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.pipeDataConsumerId)
			return next();

		const pipeDataConsumer = pipeDataConsumers.get(message.data.pipeDataConsumerId);

		if (!pipeDataConsumer)
			return next();

		switch (message.method) {
			case 'pipeDataConsumerClosed': {
				pipeDataConsumer.close(true);
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