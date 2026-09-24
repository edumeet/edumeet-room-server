import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import { Permission } from '../common/authorization';
import { asBotType, asJobId } from '../common/botProfile';
import Room from '../Room';

const logger = new Logger('BotJobsMiddleware');

// Two callers share this middleware and never the same methods: a moderator starts
// and stops jobs, and the bot that runs them reports how they are doing. A job runs in
// the session the moderator is in when starting it, so no session id is read from
// the message. The moderator has to be signed in: the recording is delivered to
// people by their accounts, and somebody accountable must be behind it.
export const createBotJobsMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createBotJobsMiddleware() [room: %s]', room.sessionId);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
			response,
		} = context;

		switch (message.method) {
			case 'moderator:startBotJob': {
				if (peer.headless || !peer.managedId || !peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const type = asBotType(message.data?.type);
				const providerId = message.data?.providerId == null ? undefined : Number(message.data.providerId);

				if (!type) throw new Error('unknown bot job type');

				response.jobId = room.botJobs.start(peer, type, providerId);
				context.handled = true;

				break;
			}

			case 'moderator:stopBotJob': {
				if (peer.headless || !peer.managedId || !peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const jobId = asJobId(message.data?.jobId);

				if (!jobId) throw new Error('no such bot job');

				room.botJobs.stop(jobId);
				context.handled = true;

				break;
			}

			case 'botStatus': {
				if (!peer.headless || !peer.botId) break;

				room.botJobs.status(peer, message.data?.state, message.data?.reason, message.data?.type);
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
