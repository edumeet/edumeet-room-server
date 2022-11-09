import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { PipeTransport } from '../media/PipeTransport';

const logger = new Logger('PipeTransportMiddleware');

export const createPipeTransportMiddleware = ({
	pipeTransport,
}: { pipeTransport: PipeTransport }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createPipeTransportMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message,
		} = context;

		if (
			pipeTransport.router.id === message.data.routerId &&
			pipeTransport.id === message.data.pipeTransportId
		) {
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
		}

		return next();
	};

	return middleware;
};