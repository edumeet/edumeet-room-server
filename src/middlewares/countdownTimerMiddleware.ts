import { Logger, Middleware } from 'edumeet-common';
// import { hasPermission, Permission } from '../common/authorization';
import { thisSession } from '../common/checkSessionId';
import { ChatMessage, MiddlewareOptions } from '../common/types';
import { PeerContext } from '../Peer';
import moment from 'moment';

const logger = new Logger('CountdownTimerMiddleware');

export const createCountdownTimerMiddleware = ({
	room,
	// chatHistory,
	countdownTimer,
	_countdownTimerRef
}: MiddlewareOptions): Middleware<PeerContext> => {
	// logger.debug('createCountdownTimerMiddleware() [room: %s]', room.id);

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
	
				countdownTimer.isEnabled = true;
	
				room.notifyPeers('moderator:enableCountdownTimer', {
					peerId: peer.id,
					isEnabled: countdownTimer.isEnabled
				}, peer);
		
				context.handled = true;				
		
				break;
			}

			case 'moderator:disableCountdownTimer':
			{
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');
		
				// const { isEnabled } = message.data;
		
				countdownTimer.isEnabled = false;
		
				room.notifyPeers('moderator:disableCountdownTimer', {
					peerId: peer.id,
					isEnabled: countdownTimer.isEnabled
				}, peer);
			
				context.handled = true;				
			
				break;
			}

			// case 'moderator:toggleCountdownTimer':
			// {
			// 	// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
			// 	// 	throw new Error('peer not authorized');

			// 	const { isEnabled } = message.data;

			// 	countdownTimer.isEnabled = isEnabled;

			// 	room.notifyPeers('moderator:toggleCountdownTimer', {
			// 		peerId: peer.id,
			// 		isEnabled: countdownTimer.isEnabled
			// 	}, peer);
	
			// 	context.handled = true;				
	
			// 	break;
			// }

			case 'moderator:setCountdownTimer': {
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');

				const { left } = message.data;

				countdownTimer.left = left;

				room.notifyPeers('moderator:settedCountdownTimer', {
					peerId: peer.id,
					left: countdownTimer.left
				});

				context.handled = true;				

				break;
			}

			case 'moderator:startCountdownTimer':
			{
				logger.debug('moderator:startCountdownTimer');
	
				// if (!hasPermission(room, peer, Permission.MODERATE_ROOM))
				// 	throw new Error('peer not authorized');
				
				countdownTimer.isRunning = true;

				// room.notifyPeers('moderator:settedCountdownTimer', {
				// 	peerId: peer.id,
				// 	// isEnabled: countdownTimer.isEnabled,
				// 	// left: countdownTimer.left,
				// 	isRunning: countdownTimer.isRunning
				// });

				clearInterval(_countdownTimerRef);

				_countdownTimerRef = setInterval(() => {
					let left = moment(`1000-01-01 ${countdownTimer.left}`).unix();
					const end = moment('1000-01-01 00:00:00').unix();

					left--;
					// eslint-disable-next-line no-console
					console.log(`${countdownTimer.left} :ooo `);
					countdownTimer.left = moment.unix(left).format('HH:mm:ss');
	
					if (left === end || room.empty) {
						clearInterval(_countdownTimerRef);
	
						countdownTimer.isRunning = false;
						countdownTimer.left = '00:00:00';

						// room.notifyPeers('moderator:settedCountdownTimer', {
						// 	peerId: peer.id,
						// 	left: countdownTimer.left,
						// 	// isRunning: countdownTimer.isRunning
						// });

						room.notifyPeers('moderator:stoppedCountdownTimer', {
							peerId: peer.id,
							isRunning: countdownTimer.isRunning
						});
					}
	
				}, 1000);

				room.notifyPeers('moderator:settedCountdownTimer', {
					peerId: peer.id,
					left: countdownTimer.left,
				});

				room.notifyPeers('moderator:startedCountdownTimer', {
					peerId: peer.id,
					// isEnabled: countdownTimer.isEnabled,
					// left: countdownTimer.left,
					isRunning: countdownTimer.isRunning
				});
	
				context.handled = true;				
	
				break;
			}

			case 'moderator:stopCountdownTimer':
			{
				logger.debug('moderator:stopCountdownTimer ');
	
				if (countdownTimer.isRunning) {
					// if (!this._hasPermission(peer, MODERATE_ROOM))
					// 	throw new Error('peer not authorized');
	
					// countdownTimer.isRunning = false;
	
					clearInterval(_countdownTimerRef);
					countdownTimer.isRunning = false;
					// eslint-disable-next-line no-console
					// console.log(`${countdownTimer.left} :ooo `);

					room.notifyPeers('moderator:settedCountdownTimer', {
						peerId: peer.id,
						left: countdownTimer.left,
						// isRunning: countdownTimer.isRunning
					});

					room.notifyPeers('moderator:stoppedCountdownTimer', {
						peerId: peer.id,
						isRunning: countdownTimer.isRunning
					});
	
				}

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