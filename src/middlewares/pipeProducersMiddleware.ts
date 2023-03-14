import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeProducer } from '../media/PipeProducer';

const logger = new Logger('PipeProducersMiddleware');

export const createPipeProducersMiddleware = ({
	routerId,
	pipeProducers,
}: {
	routerId: string;
	pipeProducers: Map<string, PipeProducer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.pipeProducerId)
			return next();

		const pipeProducer = pipeProducers.get(message.data.pipeProducerId);

		if (!pipeProducer)
			return next();

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

		return next();
	};

	return middleware;
};