import { Permission } from '../common/authorization';
import { PeerContext } from '../Peer';
// import { thisSession } from '../common/checkSessionId';
import { Logger, Middleware } from 'edumeet-common';
import moment from 'moment';
import Room from '../Room';

const logger = new Logger('CountdownTimerMiddleware');

export const createCountdownTimerMiddleware = ({ room }: { room: Room }): Middleware<PeerContext> => {
	logger.debug('createCountdownTimerMiddleware() [room: %s]', room.id);

	const middleware: Middleware<PeerContext> = async (
		context,
		next
	) => {
		const {
			peer,
			message,
		} = context;

		// if (!thisSession(room, message))
		// 	return next();
		
		switch (message.method) {

			case 'moderator:enableCountdownTimer':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
				
				room.countdownTimer.isEnabled = true;
	
				room.notifyPeers('moderator:enabledCountdownTimer', {
					isEnabled: room.countdownTimer.isEnabled
				}, peer);
		
				context.handled = true;				
		
				break;
			}

			case 'moderator:disableCountdownTimer':
			{
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
		
				room.countdownTimer.isEnabled = false;
		
				room.notifyPeers('moderator:disabledCountdownTimer', {
					isEnabled: room.countdownTimer.isEnabled
				}, peer);
			
				context.handled = true;				
			
				break;
			}

			case 'moderator:startCountdownTimer':
			{
				logger.debug('moderator:startCountdownTimer');
	
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
				
				room.countdownTimer.isStarted = true;

				clearInterval(room._countdownTimerRef as NodeJS.Timeout);

				room._countdownTimerRef = setInterval(() => {
					let remainingTime = moment(`1000-01-01 ${room.countdownTimer.remainingTime}`).unix();
					const end = moment('1000-01-01 00:00:00').unix();

					remainingTime--;

					room.countdownTimer.remainingTime = moment.unix(remainingTime).format('HH:mm:ss');
					
					if (remainingTime === end || room.empty) {
						clearInterval(room._countdownTimerRef as NodeJS.Timeout);
						
						room.countdownTimer.isStarted = false;
						room.countdownTimer.remainingTime = '00:00:00';
						
						room.notifyPeers('moderator:finishedCountdownTimer', {
							isStarted: room.countdownTimer.isStarted,
							remainingTime: room.countdownTimer.remainingTime
						});
					}
	
				}, 1000);

				room.notifyPeers('moderator:settedCountdownTimerRemainingTime', room.countdownTimer.remainingTime);

				room.notifyPeers('moderator:startedCountdownTimer', {
					isStarted: room.countdownTimer.isStarted
				});
	
				context.handled = true;				
	
				break;
			}

			case 'moderator:stopCountdownTimer':
			{
				logger.debug('moderator:stopCountdownTimer ');
				
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');
	
				if (room.countdownTimer.isStarted) {
	
					clearInterval(room._countdownTimerRef as NodeJS.Timeout);
					
					room.countdownTimer.isStarted = false;

					room.notifyPeers('moderator:settedCountdownTimerRemainingTime', room.countdownTimer.remainingTime);

					room.notifyPeers('moderator:stoppedCountdownTimer', {
						isStarted: room.countdownTimer.isStarted
					});
	
				}

				context.handled = true;				
	
				break;
			}

			case 'moderator:setCountdownTimerInitialTime': {
				if (!peer.hasPermission(Permission.MODERATE_ROOM))
					throw new Error('peer not authorized');

				const time = message.data;

				if (!moment(time, 'HH:mm:ss', true).isValid())
					throw new Error('Invalid time format');
				
				room.countdownTimer.remainingTime = time;
				room.countdownTimer.initialTime = time;

				room.notifyPeers('moderator:settedCountdownTimerInitialTime', room.countdownTimer.initialTime);

				room.notifyPeers('moderator:settedCountdownTimerRemainingTime', room.countdownTimer.remainingTime);

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