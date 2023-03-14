import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeTransport } from '../media/PipeTransport';

const logger = new Logger('PipeTransportsMiddleware');

export const createPipeTransportsMiddleware = ({
	routerId,
	pipeTransports,
}: {
	routerId: string;
	pipeTransports: Map<string, PipeTransport>;
}): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeTransportsMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (routerId !== message.data.routerId || !message.data.pipeTransportId)
			return next();

		const pipeTransport = pipeTransports.get(message.data.pipeTransportId);

		if (!pipeTransport)
			return next();

		switch (message.method) {
			case 'pipeTransportClosed': {
				pipeTransport.close();
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