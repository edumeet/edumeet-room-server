import { Logger, Middleware } from 'edumeet-common';
import { PeerContext } from '../Peer';
import Room from '../Room';
import { MlsGroup } from '../mls/MlsGroup';
import { addressOf, limitHit } from '../common/suspiciousClients';

const logger = new Logger('MlsMiddleware');

const MAX_MESSAGE_LENGTH = 1024 * 1024;
const MAX_SMALL_MESSAGE_LENGTH = 64 * 1024;
const BUSY_RETRY_MS = 5_000;

// The client sends these only in a room with end-to-end encryption on, which the room tells it.
// In any other room they would only be relayed to the others and kept for recovery.
const MLS_METHODS = new Set([ 'mlsJoin', 'mlsEpoch', 'mlsGroupInfo', 'mlsCommit', 'mlsKeyPackage', 'mlsKeyPackages', 'mlsProposal' ]);

type PeerLike = PeerContext['peer'];

const isMlsMessage = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_MESSAGE_LENGTH;
const isSmallMlsMessage = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_SMALL_MESSAGE_LENGTH;
const isEpoch = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
// A Welcome goes to the members a commit adds; no room has more at once. The welcome is sent
// once per listed peer, so without a limit one request could make the server send gigabytes.
const MAX_WELCOME_TO = 64;

const isPeerIdList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.length <= MAX_WELCOME_TO && value.every((id) => typeof id === 'string');

// The MLS delivery service. The server stores opaque GroupInfo and KeyPackage bytes, orders commits by epoch, and
// relays commits, Welcomes and proposals with the sender id stamped by the server. It reads none
// of it. A room participant that sends a malformed commit can still desynchronise the group, as it
// can disrupt a room in other ways; the server is trusted for membership, not for secrecy.
export const createMlsMiddleware = ({ room }: { room: Room; }): Middleware<PeerContext> => {
	logger.debug('createMlsMiddleware() [room: %s]', room.sessionId);

	const group = new MlsGroup();
	const watched = new WeakSet<PeerLike>();

	room.once('close', () => group.reset());
	// The room cleared its content because its last participant left; the next meeting in it
	// starts a new group instead of inheriting the old members.
	room.on('contentCleared', () => group.reset());

	const watch = (peer: PeerLike): void => {
		if (watched.has(peer)) return;

		watched.add(peer);
		peer.once('close', () => group.removePeer(peer.id));
	};

	const middleware: Middleware<PeerContext> = async (context, next) => {
		const { peer, message } = context;
		const data = message.data ?? {};

		if (MLS_METHODS.has(message.method) && !room.endToEndEncryption) throw new Error('end-to-end encryption is off');

		switch (message.method) {
			case 'mlsJoin': {
				// The answer to a joiner is the stored GroupInfo, up to a megabyte. A peer that
				// asks for it too often is told to wait, as when another joiner is at work,
				// before the group notes anything about it. Not reported: a client that is told
				// to wait asks again, and the answer costs nothing.
				const length = group.joinAnswerLength(peer.id);

				if (length > 0 && !peer.mlsJoins.take()) {
					context.response = { role: 'wait', retryAfterMs: BUSY_RETRY_MS };
					context.handled = true;

					break;
				}

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
						for (const id of new Set(welcomeTo as string[])) {
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
				// Every peer's key package, up to 64 kB each.
				if (!peer.mlsKeyPackageRequests.take()) {
					limitHit(addressOf(peer));

					throw new Error('Too many requests');
				}

				context.response = { keyPackages: group.keyPackages() };
				context.handled = true;

				break;
			}

			case 'mlsProposal': {
				const { proposal, toPeerId } = data;

				if (!isSmallMlsMessage(proposal)) throw new Error('invalid proposal');

				// Passed on to everyone; the client does not send proposals.
				if (!peer.mlsProposals.take()) {
					limitHit(addressOf(peer));

					throw new Error('Too many requests');
				}
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
