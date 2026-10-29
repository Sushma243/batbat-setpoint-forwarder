import { InvocationContext } from '@azure/functions';
import { BatteryApiError, SetpointSender } from './batteredBatteriesClient';
import { ALLOWED_DEVICES } from './config';
import { IncomingSetpoint, latestPerDevice, parseSetpoint } from './setpoint';

export function createSetpointHandler(sender: SetpointSender, allowedDevices: ReadonlySet<string> = ALLOWED_DEVICES) {
  return async (messages: unknown, context: InvocationContext): Promise<void> => {
    const batch = Array.isArray(messages) ? messages : [messages];
    const accepted: IncomingSetpoint[] = [];
    for (const raw of batch) {
      const setpoint = parseSetpoint(raw);
      if (!setpoint) {
        context.warn('Dropping malformed setpoint message');
      } else if (!allowedDevices.has(setpoint.device_id)) {
        context.warn(`Abandoning setpoint for unknown device ${JSON.stringify(setpoint.device_id)}`);
      } else {
        accepted.push(setpoint);
      }
    }

    const toSend = latestPerDevice(accepted);
    const results = await Promise.allSettled(toSend.map((sp) => sender.sendSetpoint(sp)));

    let transientFailures = 0;
    results.forEach((result, i) => {
      const deviceId = toSend[i].device_id;
      if (result.status === 'fulfilled') {
        if (result.value === 'expired') context.warn(`Skipping expired setpoint for device ${deviceId}`);
        return;
      }
      const err = result.reason;
      context.error(`Failed to send setpoint for device ${deviceId}: ${err instanceof Error ? err.message : err}`);
      if (err instanceof BatteryApiError && err.retryable) transientFailures++;
    });

    // Throwing lets Service Bus redeliver the batch; resending already-applied setpoints is harmless since they override.
    if (transientFailures > 0) {
      throw new Error(`${transientFailures} setpoint(s) failed with transient errors`);
    }
  };
}
