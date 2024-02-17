import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('RecordersMiddleware');

export const createRecordersMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createRecordersMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { recorderId, routerId },
				method,
			},
		} = context;

		if (!recorderId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const recorder = router.recorders.get(recorderId);

		if (!recorder)
			return next();

		switch (method) {
			case 'recorderClosed': {
				recorder.close();
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