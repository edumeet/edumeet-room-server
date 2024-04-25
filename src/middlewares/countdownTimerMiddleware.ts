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
					let timeLeft = moment(`1000-01-01 ${room.countdownTimer.timeLeft}`).unix();
					const end = moment('1000-01-01 00:00:00').unix();

					timeLeft--;

					room.countdownTimer.timeLeft = moment.unix(timeLeft).format('HH:mm:ss');
					
					console.log('room.countdownTimer.timeLeft: ', room.countdownTimer.timeLeft); // eslint-disable-line

					if (timeLeft === end || room.empty) {
						clearInterval(room._countdownTimerRef);
						
						room.countdownTimer.isStarted = false;
						room.countdownTimer.timeLeft = '00:00:00';

						room.notifyPeers('moderator:updatedCountdownTimer', {
							timeLeft: room.countdownTimer.timeLeft
						});

						room.notifyPeers('moderator:stoppedCountdownTimer', {
							isStarted: room.countdownTimer.isStarted
						});
					}
	
				}, 1000);

				room.notifyPeers('moderator:updatedCountdownTimer', {
					timeLeft: room.countdownTimer.timeLeft,
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
						timeLeft: room.countdownTimer.timeLeft,
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

				const { timeLeft } = message.data;

				room.countdownTimer.timeLeft = timeLeft;
				room.countdownTimer.timeInit = timeLeft;

				room.notifyPeers('moderator:setCountdownTimer', {
					timeLeft: room.countdownTimer.timeLeft
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