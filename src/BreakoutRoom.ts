import { EventEmitter } from 'events';
import { Peer, PeerContext } from './Peer';
import { randomUUID } from 'crypto';
import { List, Logger, Middleware, skipIfClosed } from 'edumeet-common';
import Room from './Room';
import { ChatMessage, FileMessage, MiddlewareOptions } from './common/types';
import { createMediaMiddleware } from './middlewares/mediaMiddleware';
import { createChatMiddleware } from './middlewares/chatMiddleware';
import { createFileMiddleware } from './middlewares/fileMiddleware';

const logger = new Logger('BreakoutRoom');

interface BreakoutRoomOptions {
	name?: string;
	parent: Room;
}

export default class BreakoutRoom extends EventEmitter {
	public name?: string;
	public sessionId = randomUUID();
	public closed = false;
	public readonly creationTimestamp = Date.now();
	
	public parent: Room;
	public peers = List<Peer>();

	public chatHistory: ChatMessage[] = [];
	public fileHistory: FileMessage[] = [];

	private peerMiddlewares: Middleware<PeerContext>[] = [];

	constructor({ name, parent }: BreakoutRoomOptions) {
		logger.debug('constructor() [parent: %s]', parent.id);

		super();

		this.name = name;
		this.parent = parent;

		const breakoutMiddlewareOptions = {
			room: parent,
			chatHistory: this.chatHistory,
			fileHistory: this.fileHistory,
			breakoutRoom: this,
		} as MiddlewareOptions;

		this.peerMiddlewares.push(
			createMediaMiddleware(breakoutMiddlewareOptions),
			createChatMiddleware(breakoutMiddlewareOptions),
			createFileMiddleware(breakoutMiddlewareOptions),
		);
	}

	@skipIfClosed
	public close() {
		logger.debug('close() [sessionId: %s]', this.sessionId);

		this.closed = true;

		// TODO: handle peers still being in the breakout room when it closes
		this.peers.clear();

		this.emit('close');
	}

	public get empty(): boolean {
		return this.peers.empty;
	}

	@skipIfClosed
	public removePeer(peer: Peer): void {
		logger.debug('removePeer() [sessionId: %s, id: %s]', this.sessionId, peer.id);

		if (this.peers.remove(peer))
			this.peerMiddlewares.forEach((m) => peer.pipeline.remove(m));
	}

	@skipIfClosed
	public addPeer(peer: Peer): void {
		logger.debug('addPeer() [id: %s]', peer.id);

		peer.once('close', () => this.removePeer(peer));

		peer.pipeline.use(...this.peerMiddlewares);
		this.peers.add(peer);

		// This will trigger the consumers of peers not in the breakout room
		// to be closed
		peer.sessionId = this.sessionId;

		// TODO: handle on client side
		this.notifyPeers('newPeerInBreakoutRoom', {
			sessionId: this.sessionId,
			peerId: peer.id,
		}, peer);
	}

	public getPeers(excludePeer?: Peer): Peer[] {
		return this.peers.items.filter((p) => p !== excludePeer);
	}

	@skipIfClosed
	public notifyPeers(method: string, data: unknown, excludePeer?: Peer): void {
		const peers = this.getPeers(excludePeer);

		for (const peer of peers) {
			peer.notify({ method, data });
		}
	}
}