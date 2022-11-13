import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeDataConsumer } from '../media/PipeDataConsumer';

const logger = new Logger('PipeDataConsumerMiddleware');

export const createPipeDataConsumerMiddleware = ({
	pipeDataConsumer,
}: { pipeDataConsumer: PipeDataConsumer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeDataConsumerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			pipeDataConsumer.router.id === message.data.routerId &&
			pipeDataConsumer.id === message.data.pipeDataConsumerId
		) {
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
		}

		return next();
	};

	return middleware;
};