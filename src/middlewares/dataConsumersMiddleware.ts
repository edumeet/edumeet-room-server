import { Logger, Middleware } from 'edumeet-common';
import { DataConsumer } from '../media/DataConsumer';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';

const logger = new Logger('DataConsumersMiddleware');

export const createDataConsumersMiddleware = ({
	routerId,
	dataConsumers,
}: {
	routerId: string;
	dataConsumers: Map<string, DataConsumer>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createDataConsumersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.dataConsumerId)
			return next();

		const dataConsumer = dataConsumers.get(message.data.dataConsumerId);

		if (!dataConsumer)
			return next();

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

		return next();
	};

	return middleware;
};