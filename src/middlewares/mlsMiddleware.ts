import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { MlsGroup } from '../mls/MlsGroup';

const logger = new Logger('MlsMiddleware');

const MAX_MESSAGE_LENGTH = 1024 * 1024;
const MAX_SMALL_MESSAGE_LENGTH = 64 * 1024;

type PeerLike = PeerContext['peer'];

const isMlsMessage = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_MESSAGE_LENGTH;
const isSmallMlsMessage = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_SMALL_MESSAGE_LENGTH;
const isEpoch = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isPeerIdList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((id) => typeof id === 'string');

// The MLS delivery service, living beside the pairwise relay in e2eeMiddleware so that a client can
// use either. The server stores opaque GroupInfo and KeyPackage bytes, orders commits by epoch, and
// relays commits, Welcomes and proposals with the sender id stamped by the server. It reads none
// of it. A room participant that sends a malformed commit can still desynchronise the group, as it
// can disrupt a room in other ways; the server is trusted for membership, not for secrecy.
export const createMlsMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createMlsMiddleware() [room: %s]', room.sessionId);

	const group = new MlsGroup();
	const watched = new WeakSet<PeerLike>();

	room.once('close', () => group.reset());

	const watch = (peer: PeerLike): void => {
		if (watched.has(peer)) return;

		watched.add(peer);
		peer.once('close', () => group.removePeer(peer.id));
	};

	const middleware: Middleware<PeerContext> = async (context, next) => {
		const { peer, message } = context;
		const data = message.data ?? {};

		switch (message.method) {
			case 'mlsJoin': {
				watch(peer);

				context.response = group.join(peer.id);
				context.handled = true;

				break;
			}

			case 'mlsEpoch': {
				context.response = { epoch: group.epoch ?? -1 };
				context.handled = true;

				break;
			}

			case 'mlsGroupInfo': {
				const { epoch, groupInfo } = data;

				if (!isEpoch(epoch) || !isMlsMessage(groupInfo)) throw new Error('invalid group info');

				watch(peer);

				const accepted = group.publish(peer.id, epoch, groupInfo);

				context.response = { accepted, epoch: group.epoch ?? -1 };
				context.handled = true;

				break;
			}

			case 'mlsCommit': {
				const { epoch, commit, groupInfo, welcome, welcomeTo } = data;

				if (!isEpoch(epoch) || !isMlsMessage(commit) || !isMlsMessage(groupInfo)) throw new Error('invalid commit');
				if (welcome !== undefined && (!isMlsMessage(welcome) || !isPeerIdList(welcomeTo))) throw new Error('invalid welcome');

				watch(peer);

				const result = group.commit(peer.id, epoch, groupInfo);

				if (result.accepted) {
					room.notifyPeers('mlsCommit', { fromPeerId: peer.id, epoch: result.epoch, commit }, peer);

					if (welcome) {
						for (const id of welcomeTo as string[]) {
							room.getPeerById(id)?.notify({
								method: 'mlsWelcome',
								data: { fromPeerId: peer.id, epoch: result.epoch, welcome },
							});
						}
					}
				}

				context.response = result;
				context.handled = true;

				break;
			}

			case 'mlsKeyPackage': {
				const { keyPackage } = data;

				if (!isSmallMlsMessage(keyPackage)) throw new Error('invalid key package');

				watch(peer);
				group.storeKeyPackage(peer.id, keyPackage);

				context.handled = true;

				break;
			}

			case 'mlsKeyPackages': {
				context.response = { keyPackages: group.keyPackages() };
				context.handled = true;

				break;
			}

			case 'mlsProposal': {
				const { proposal, toPeerId } = data;

				if (!isSmallMlsMessage(proposal)) throw new Error('invalid proposal');
				if (toPeerId !== undefined && typeof toPeerId !== 'string') throw new Error('invalid proposal target');

				const relayed = { fromPeerId: peer.id, proposal };

				if (toPeerId !== undefined)
					room.getPeerById(toPeerId)?.notify({ method: 'mlsProposal', data: relayed });
				else
					room.notifyPeers('mlsProposal', relayed, peer);

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
