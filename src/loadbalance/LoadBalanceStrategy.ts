import { List } from 'edumeet-common';
import MediaNode from '../media/MediaNode';
import Room from '../Room';

export abstract class LoadBalanceStrategy {
    // eslint-disable-next-line no-unused-vars
    abstract getCandidates(mediaNodes: List<MediaNode>, room: Room): MediaNode[]
}