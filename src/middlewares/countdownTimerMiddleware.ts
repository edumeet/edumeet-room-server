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

				// room.notifyPeers('moderator:setCountdownTimer', {
				// 	// isEnabled: room.countdownTimer.isEnabled,
				// 	// left: room.countdownTimer.left,
				// 	isStarted: room.countdownTimer.isStarted
				// });

				clearInterval(room._countdownTimerRef);

				room._countdownTimerRef = setInterval(() => {
					let left = moment(`1000-01-01 ${room.countdownTimer.left}`).unix();
					const end = moment('1000-01-01 00:00:00').unix();

					left--;

					console.log('left', left); // eslint-disable-line
					
					room.countdownTimer.left = moment.unix(left).format('HH:mm:ss');

					if (left === end || room.empty) {
						clearInterval(room._countdownTimerRef);
						
						room.countdownTimer.isStarted = false;
						room.countdownTimer.left = '00:00:00';

						// room.notifyPeers('moderator:setCountdownTimer', {
						// 	left: room.countdownTimer.left,
						// 	// isStarted: room.countdownTimer.isStarted
						// });

						room.notifyPeers('moderator:stoppedCountdownTimer', {
							isStarted: room.countdownTimer.isStarted
						});
					}
	
				}, 1000);

				room.notifyPeers('moderator:setCountdownTimer', {
					left: room.countdownTimer.left,
				});

				room.notifyPeers('moderator:startedCountdownTimer', {
					// isEnabled: room.countdownTimer.isEnabled,
					// left: room.countdownTimer.left,
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
	
					// room.countdownTimer.isStarted = false;
	
					clearInterval(room._countdownTimerRef);
					room.countdownTimer.isStarted = false;

					room.notifyPeers('moderator:setCountdownTimer', {
						left: room.countdownTimer.left,
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

				const { left } = message.data;

				room.countdownTimer.left = left;

				room.notifyPeers('moderator:setCountdownTimer', {
					left: room.countdownTimer.left
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