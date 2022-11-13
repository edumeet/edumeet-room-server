import { Logger, Middleware } from 'edumeet-common';
import { DataProducer } from '../media/DataProducer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';

const logger = new Logger('DataProducerMiddleware');

export const createDataProducerMiddleware = ({
	dataProducer,
}: { dataProducer: DataProducer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createDataProducerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			dataProducer.router.id === message.data.routerId &&
			dataProducer.id === message.data.dataProducerId
		) {
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
		}

		return next();
	};

	return middleware;
};