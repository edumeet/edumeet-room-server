import { Logger, Middleware } from 'edumeet-common';
import { DataProducer } from '../media/DataProducer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';

const logger = new Logger('DataProducersMiddleware');

export const createDataProducersMiddleware = ({
	routerId,
	dataProducers,
}: {
	routerId: string;
	dataProducers: Map<string, DataProducer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createDataProducersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.dataProducerId)
			return next();

		const dataProducer = dataProducers.get(message.data.dataProducerId);

		if (!dataProducer)
			return next();

		switch (message.method) {
			case 'dataProducerClosed': {
				dataProducer.close(true);
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