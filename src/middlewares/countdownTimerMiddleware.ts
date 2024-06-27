import { Logger, Middleware } from 'edumeet-common';
// import { hasPermission, Permission } from '../common/authorization';
// import { thisSession } from '../common/checkSessionId';
import { PeerContext } from '../Peer';
import moment from 'moment';

const logger = new Logger('CountdownTimerMiddleware');

import Room from '../Room';

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
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');
				
				// const { isEnabled } = message.data;
	
				room.countdownTimer.isEnabled = true;
	
				room.notifyPeers('moderator:enabledCountdownTimer', {
					isEnabled: room.countdownTimer.isEnabled
				}, peer);
		
				context.handled = true;				
		
				break;
			}

			case 'moderator:disableCountdownTimer':
			{
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');
		
				// const { isEnabled } = message.data;
		
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
	
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');
				
				room.countdownTimer.isStarted = true;

				clearInterval(room._countdownTimerRef);

				room._countdownTimerRef = setInterval(() => {
					let remainingTime = moment(`1000-01-01 ${room.countdownTimer.remainingTime}`).unix();
					const end = moment('1000-01-01 00:00:00').unix();

					remainingTime--;

					room.countdownTimer.remainingTime = moment.unix(remainingTime).format('HH:mm:ss');
					
					console.log('room.countdownTimer.remainingTime: ', room.countdownTimer.remainingTime); // eslint-disable-line

					if (remainingTime === end || room.empty) {
						clearInterval(room._countdownTimerRef);
						
						room.countdownTimer.isStarted = false;
						room.countdownTimer.remainingTime = '00:00:00';

						room.notifyPeers('moderator:updatedCountdownTimer', {
							remainingTime: room.countdownTimer.remainingTime
						});

						room.notifyPeers('moderator:stoppedCountdownTimer', {
							isStarted: room.countdownTimer.isStarted
						});
					}
	
				}, 1000);

				room.notifyPeers('moderator:updatedCountdownTimer', {
					remainingTime: room.countdownTimer.remainingTime,
				});

				room.notifyPeers('moderator:startedCountdownTimer', {
					isStarted: room.countdownTimer.isStarted
				});
	
				context.handled = true;				
	
				break;
			}

			case 'moderator:stopCountdownTimer':
			{
				logger.debug('moderator:stopCountdownTimer ');
	
				if (room.countdownTimer.isStarted) {
					// if (!this._hasPermission(peer, MODERATE_ROOM))
					// 	throw new Error('peer not authorized');
	
					clearInterval(room._countdownTimerRef);
					
					room.countdownTimer.isStarted = false;

					room.notifyPeers('moderator:updatedCountdownTimer', {
						remainingTime: room.countdownTimer.remainingTime,
						// isStarted: room.countdownTimer.isStarted
					});

					room.notifyPeers('moderator:stoppedCountdownTimer', {
						isStarted: room.countdownTimer.isStarted
					});
	
				}

				context.handled = true;				
	
				break;
			}

			case 'moderator:setCountdownTimer': {
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');

				const { remainingTime } = message.data;

				room.countdownTimer.remainingTime = remainingTime;
				room.countdownTimer.initialTime = remainingTime;

				room.notifyPeers('moderator:hasSetCountdownTimer', {
					remainingTime: room.countdownTimer.remainingTime,
					initialTime: room.countdownTimer.initialTime
				});

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