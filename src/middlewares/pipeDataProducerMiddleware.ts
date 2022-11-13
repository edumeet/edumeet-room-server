import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeDataProducer } from '../media/PipeDataProducer';

const logger = new Logger('PipeDataProducerMiddleware');

export const createPipeDataProducerMiddleware = ({
	pipeDataProducer,
}: { pipeDataProducer: PipeDataProducer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeDataProducerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			pipeDataProducer.router.id === message.data.routerId &&
			pipeDataProducer.id === message.data.pipeDataProducerId
		) {
			switch (message.method) {
				case 'pipeDataProducerClosed': {
					pipeDataProducer.close(true);
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