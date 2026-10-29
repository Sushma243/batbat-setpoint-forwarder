import { describe, expect, it } from 'vitest';
import { IncomingSetpoint, toBatteryPayload } from '../src/setpoint';

describe('toBatteryPayload', () => {
  it('converts a grid-perspective kW setpoint into battery-perspective watts with epoch-second times starting now', () => {
    const incoming: IncomingSetpoint = {
      device_id: 'BB00001',
      setpoint: { value: 1, unit: 'kW', endTime: '2025-01-01T10:01:00.000Z' },
      eventTime: '2025-01-01T10:00:00.000Z',
    };
    const arrival = Date.parse('2025-01-01T10:00:00.000Z');

    expect(toBatteryPayload(incoming, arrival)).toEqual({
      startTime: 1735725601,
      endTime: 1735725660,
      value: -1000,
    });
  });
});

// TODO: toBatteryPayload with a negative grid value (-2.5 kW) should produce a positive 2500 W charge value
// TODO: toBatteryPayload with a fractional kW value (0.0014 kW) should round to a whole number of watts (-1)
// TODO: toBatteryPayload with a value of 0 kW should send 0, not -0
// TODO: toBatteryPayload with nowMs containing milliseconds should round startTime up so it is never in the past
// TODO: parseSetpoint should accept a JSON string and a Buffer body as well as an already-parsed object
// TODO: parseSetpoint should return null when unit is "W" instead of "kW"
// TODO: parseSetpoint should return null when setpoint.value is missing, a string, NaN or Infinity
// TODO: parseSetpoint should return null when endTime or eventTime is not a valid ISO date
// TODO: parseSetpoint should return null for invalid JSON text instead of throwing
// TODO: latestPerDevice should keep only the setpoint with the newest eventTime when one device appears multiple times in a batch, regardless of message order
// TODO: latestPerDevice should keep one setpoint per device when the batch contains several different devices
// TODO: sendSetpoint should POST to /{device}/setpoint with body { data: payload }
// TODO: sendSetpoint should return 'expired' without calling the API when endTime is not after startTime
// TODO: sendSetpoint should retry when the API returns 429 and wait for the Retry-After header duration
// TODO: sendSetpoint should retry with exponential backoff when the API returns 500 and succeed on a later attempt
// TODO: sendSetpoint should retry on a network timeout (no response) and throw a retryable BatteryApiError after maxAttempts
// TODO: sendSetpoint should not retry and should throw a non-retryable BatteryApiError when the API returns 400, 401 or 404
// TODO: sendSetpoint should recompute startTime on each retry so it is still in the future after backing off
// TODO: sendSetpoint should cap the retry delay at maxDelayMs even when Retry-After is very large
// TODO: BatteryApiError message should never contain the Ocp-Apim-Subscription-Key value
// TODO: BatteredBatteriesClient.fromConfig should send the API key in the Ocp-Apim-Subscription-Key header
// TODO: getApiConfig should throw when BATBAT_API_KEY is not set
// TODO: createSetpointHandler should not call the API for a device_id that is not in the allowed list and should log a warning
// TODO: createSetpointHandler should drop malformed messages and still forward the valid messages in the same batch
// TODO: createSetpointHandler should send only one request per device when a batch contains several setpoints for that device
// TODO: createSetpointHandler should throw (so Service Bus redelivers the batch) when any setpoint fails with a retryable error
// TODO: createSetpointHandler should not throw when a setpoint fails with a non-retryable error such as 404, and should log the error
// TODO: createSetpointHandler should still send the setpoints for other devices when the request for one device fails
