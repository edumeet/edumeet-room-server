import {
	Worker,
	Router,
	Transport,
	Producer,
	Consumer,
	DataProducer,
	DataConsumer
} from 'mediasoup/types';
import ServerManager from '../ServerManager';
import ManagementService from '../ManagementService';

/* eslint-disable no-var */
declare global {
	var serverManager: ServerManager;
	var managementService: ManagementService | undefined;
	var workers: Map<number, Worker>;
	var routers: Map<string, Router>;
	var transports: Map<string, Transport>;
	var producers: Map<string, Producer>;
	var consumers: Map<string, Consumer>;
	var dataProducers: Map<string, DataProducer>;
	var dataConsumers: Map<string, DataConsumer>;
}