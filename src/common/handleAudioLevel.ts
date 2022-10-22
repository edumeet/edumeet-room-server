import { Producer } from 'mediasoup/node/lib/Producer';
import { Router } from 'mediasoup/node/lib/Router';
import { RouterData } from '../MediaService';

export const handleAudioLevel = async (router: Router) => {
	const { peers } = router.appData.serverData as RouterData;
	const {
		audioLevelObserverPromise
	} = router.appData.serverData as RouterData;

	let currentActiveSpeaker: string | undefined;
	const audioLevelObserver = await audioLevelObserverPromise;

	audioLevelObserver.on('volumes', (volumes) => {
		const { producer: { appData } } = volumes[0];

		if (currentActiveSpeaker === appData.peerId) return;

		currentActiveSpeaker = appData.peerId as string;

		for (const peer of peers.values()) {
			peer.notify({
				method: 'activeSpeaker',
				data: {
					peerId: appData.peerId,
				}
			});
		}
	});

	audioLevelObserver.on('silence', () => {
		currentActiveSpeaker = undefined;

		for (const peer of peers.values()) {
			peer.notify({
				method: 'activeSpeaker',
				data: {
					peerId: null,
				}
			});
		}
	});
};

export const addProducer = async (producer: Producer, router?: Router) => {
	if (router && producer.kind === 'audio') {
		const {
			audioLevelObserverPromise
		} = router.appData.serverData as RouterData;
		const audioLevelObserver = await audioLevelObserverPromise;

		if (!producer.closed)
			await audioLevelObserver.addProducer({ producerId: producer.id });
	}
};