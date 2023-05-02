import { Logger, Middleware } from 'edumeet-common';
import { MediaNodeConnectionContext } from '../media/MediaNodeConnection';
import { Router } from '../media/Router';

const logger = new Logger('ActiveSpeakerMiddleware');

export const createActiveSpeakerMiddleware = ({
	routers,
}: { routers: Map<string, Router>; }): Middleware<MediaNodeConnectionContext> => {
	logger.debug('createActiveSpeakerMiddleware()');

	const middleware: Middleware<MediaNodeConnectionContext> = async (
		context,
		next
	) => {
		const {
			message: {
				data: { activeSpeakerObserverId, routerId },
				method,
			},
		} = context;

		if (!activeSpeakerObserverId)
			return next();

		const router = routers.get(routerId);

		if (!router)
			return next();

		const activeSpeakerObserver = router.activeSpeakerObservers.get(activeSpeakerObserverId);

		if (!activeSpeakerObserver)
			return next();

		switch (method) {
			case 'activeSpeakerObserverClosed': {
				activeSpeakerObserver.close(true);
				context.handled = true;

				break;
			}

			case 'activeSpeakerObserverDominantSpeaker': {
				const { dominantSpeakerId } = context.message.data;

				activeSpeakerObserver.setActiveSpeakerId(dominantSpeakerId);
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