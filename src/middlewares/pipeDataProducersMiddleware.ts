import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeDataProducer } from '../media/PipeDataProducer';

const logger = new Logger('PipeDataProducersMiddleware');

export const createPipeDataProducersMiddleware = ({
	routerId,
	pipeDataProducers,
}: {
	routerId: string;
	pipeDataProducers: Map<string, PipeDataProducer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeDataProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.pipeDataProducerId)
			return next();

		const pipeDataProducer = pipeDataProducers.get(message.data.pipeDataProducerId);

		if (!pipeDataProducer)
			return next();

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

		return next();
	};

	return middleware;
};