import { app } from '@azure/functions';
import { BatteredBatteriesClient } from '../batteredBatteriesClient';
import { getApiConfig, SERVICE_BUS_CONNECTION, SETPOINT_QUEUE } from '../config';
import { createSetpointHandler } from '../setpointHandler';

app.serviceBusQueue('setpointConsumer', {
  connection: SERVICE_BUS_CONNECTION,
  queueName: SETPOINT_QUEUE,
  cardinality: 'many',
  handler: createSetpointHandler(BatteredBatteriesClient.fromConfig(getApiConfig())),
});
