import { EventEmitter } from 'events';
import { Peer, PeerContext } from './Peer';
import { randomUUID } from 'crypto';
import { List, Logger, Middleware, skipIfClosed } from 'edumeet-common';
import Room from './Room';
import { ChatMessage, FileMessage } from './common/types';
import { createChatMiddleware } from './middlewares/chatMiddleware';
import { createFileMiddleware } from './middlewares/fileMiddleware';

const logger = new Logger('BreakoutRoom');

interface BreakoutRoomOptions {
	name: string;
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

		this.peerMiddlewares.push(
			createChatMiddleware({ room: this }),
			createFileMiddleware({ room: this }),
		);
	}

	@skipIfClosed
	public close() {
		logger.debug('close() [sessionId: %s]', this.sessionId);

		this.closed = true;

		this.peers.clear();

		this.emit('close');
	}

	@skipIfClosed
	public emptyRoom() {
		logger.debug('emptyRoom() [sessionId: %s]', this.sessionId);

		this.peers.clear();
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

	public get breakoutRoomInfo() {
		return {
			name: this.name,
			sessionId: this.sessionId,
		};
	}
}