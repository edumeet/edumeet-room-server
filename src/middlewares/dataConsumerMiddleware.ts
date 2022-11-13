import { Logger, Middleware } from 'edumeet-common';
import { DataConsumer } from '../media/DataConsumer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';

const logger = new Logger('DataConsumerMiddleware');

export const createDataConsumerMiddleware = ({
	dataConsumer,
}: { dataConsumer: DataConsumer }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createDataConsumerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			dataConsumer.router.id === message.data.routerId &&
			dataConsumer.id === message.data.dataConsumerId
		) {
			switch (message.method) {
				case 'dataConsumerClosed': {
					dataConsumer.close(true);
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