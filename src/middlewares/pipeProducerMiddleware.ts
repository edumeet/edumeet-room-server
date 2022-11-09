import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeProducer } from '../media/PipeProducer';

const logger = new Logger('PipeProducerMiddleware');

export const createPipeProducerMiddleware = ({
	pipeProducer,
}: { pipeProducer: PipeProducer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeProducerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			pipeProducer.router.id === message.data.routerId &&
			pipeProducer.id === message.data.pipeProducerId
		) {
			switch (message.method) {
				case 'pipeProducerClosed': {
					pipeProducer.close(true);
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