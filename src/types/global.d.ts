import { Worker } from 'mediasoup/node/lib/Worker';
import { Router } from 'mediasoup/node/lib/Router';
import { Transport } from 'mediasoup/node/lib/Transport';
import { Producer } from 'mediasoup/node/lib/Producer';
import { Consumer } from 'mediasoup/node/lib/Consumer';
import { DataProducer } from 'mediasoup/node/lib/DataProducer';
import { DataConsumer } from 'mediasoup/node/lib/DataConsumer';
import ServerManager from '../ServerManager';

/* eslint-disable no-var */
declare global {
	var serverManager: ServerManager;
	var workers: Map<number, Worker>;
	var routers: Map<string, Router>;
	var transports: Map<string, Transport>;
	var producers: Map<string, Producer>;
	var consumers: Map<string, Consumer>;
	var dataProducers: Map<string, DataProducer>;
	var dataConsumers: Map<string, DataConsumer>;
}