import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('AudioLevelMiddleware');

export const createAudioLevelMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createAudioLevelMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { audioLevelObserverId, routerId },
				method,
			},
		} = context;

		if (!audioLevelObserverId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const audioLevelObserver = router.audioLevelObservers.get(audioLevelObserverId);

		if (!audioLevelObserver)
			return next();

		switch (method) {
			case 'audioLevelObserverClosed': {
				audioLevelObserver.close(true);
				context.handled = true;

				break;
			}

			case 'audioLevelObserverVolumes': {
				const { audioLevels } = context.message.data;

				audioLevelObserver.setAudioLevels(audioLevels);
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