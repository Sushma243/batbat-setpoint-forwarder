# Battered Batteries Setpoint Forwarder

Azure Function (TypeScript, v4 programming model) that consumes batches of setpoints from the Service Bus queue `sbq-batbat-spt` and forwards them to the Battered Batteries API to steer home batteries.

```
Producer ──► Service Bus queue (sbq-batbat-spt) ──► setpointConsumer (batch) ──► POST https://BatB.azure-api.net/{device}/setpoint
```

## Requirements and how they are addressed

| Requirement | Implementation |
|---|---|
| TypeScript, v4 programming model | `app.serviceBusQueue(...)` in `src/functions/setpointConsumer.ts`, no `function.json` |
| Consume **batches** from `sbq-batbat-spt` | `cardinality: 'many'`, batch size capped in `host.json` (`maxMessageBatchSize: 50`) |
| Connection via `CONNECTION-STRING-SBQ-BATBAT-SPT` | Passed as the trigger's `connection` setting name; value comes from app settings |
| `@azure/functions` + `axios` only | No other runtime dependencies |
| Filter on known device ids | Hardcoded `ALLOWED_DEVICES` in `src/config.ts`; unknown devices are logged and not forwarded |
| Values in kW, grid perspective | Converted to whole watts and sign-flipped: `+1 kW` → `-1000 W` (API: positive = charging) |
| Active from moment of arrival | `startTime` = now (rounded up to the next second) + 1 s, because the API requires it to be in the future |
| ISO timestamps in, epoch seconds out | `endTime` converted with `Date.parse(...) / 1000` |
| Unreliable API, "don't overload" | Bounded retries with exponential backoff + jitter, honours `Retry-After`, 10 s timeout, one request per device per batch |
| Single setpoint per device, newer overrides older | Batch is reduced to the newest setpoint per device (by `eventTime`) before sending |
| vitest, 1 test + descriptive TODOs | `test/setpoint.test.ts` |

## Project structure

```
src/
  config.ts                     queue/connection names, allowed devices, API config from env
  setpoint.ts                   message validation, kW→W/sign/time mapping, latest-per-device reduction
  batteredBatteriesClient.ts    axios client, retry policy, safe error mapping
  setpointHandler.ts            batch orchestration: parse → filter → dedupe → send → settle
  functions/setpointConsumer.ts v4 trigger registration (composition root)
test/
  setpoint.test.ts              the single required test + TODO list
```

Pure mapping logic is separated from I/O; the handler receives a `SetpointSender` and the client receives its `AxiosInstance`, sleep and clock, so every part can be tested without Azure or network access.

## Mapping example

Incoming:
```json
{ "device_id": "BB00001", "setpoint": { "value": 1, "unit": "kW", "endTime": "2025-01-01T10:01:00.000Z" }, "eventTime": "2025-01-01T10:00:00.000Z" }
```
Sent (arriving at 10:00:00):
```
POST /BB00001/setpoint
Ocp-Apim-Subscription-Key: <api key>
{ "data": { "startTime": 1735725601, "endTime": 1735725660, "value": -1000 } }
```

## Error handling

| Situation | Behaviour |
|---|---|
| Malformed message (bad JSON, wrong unit, invalid dates, non-numeric value) | Logged and dropped; rest of batch continues |
| Unknown device | Logged and not forwarded |
| `endTime` already passed (or passes during retries) | Skipped, API not called |
| `429`, `5xx`, timeout / network error | Retried up to 4 attempts; payload rebuilt per attempt so `startTime` stays in the future |
| `400`, `401`, `404` | Not retried (retrying cannot fix them); logged |
| Retryable failure still failing after retries | Function throws → Service Bus redelivers the batch (and dead-letters after max delivery count) |
| One device fails | Other devices in the batch are still sent (`Promise.allSettled`) |

## Security

- API key is read from the `BATBAT_API_KEY` app setting, never hardcoded; in Azure it should be a Key Vault reference.
- `local.settings.json` is git-ignored.
- Axios errors are mapped to a `BatteryApiError` without the request config, so the key header can never reach logs.
- Untrusted queue input is validated before use; the device id is URL-encoded and only allowed ids are ever sent.
- Fails fast at startup if the API key is missing.
- Recommended: a Service Bus SAS policy with **Listen** rights only, or a managed identity instead of a connection string.

## Design decisions and trade-offs

- **"Abandon" for unknown devices.** With only `@azure/functions`, a batch trigger cannot settle individual messages. Unknown devices are therefore logged and completed instead of abandoned. Abandoning would also only cause pointless redeliveries before dead-lettering, since the device will never become valid. True per-message abandon would need `@azure/functions-extensions-servicebus`.
- **Latest per device.** Because a battery holds only one setpoint, sending older ones from the same batch is wasted load and could briefly apply a stale command.
- **Redelivering the whole batch on transient failure.** Simple and loses no messages. Resending already-applied setpoints is mostly harmless, because a setpoint overrides with the same values.
- **Duplicates and out-of-order delivery across batches.** Not fully solved within the package constraint. Options: Service Bus duplicate detection (producer sets `MessageId`), and/or storing the last sent `eventTime` per device in a shared store (Table Storage/Redis) to skip stale messages.
- **The 1-second cancel trick** from the vendor's demo is not needed for forwarding, but it is the mechanism to use if a "clear setpoint" feature is added later.

## Configuration

| Setting | Purpose |
|---|---|
| `CONNECTION-STRING-SBQ-BATBAT-SPT` | Service Bus connection string |
| `BATBAT_API_KEY` | Battered Batteries subscription key |
| `BATBAT_API_URL` | Optional base URL override (defaults to `https://BatB.azure-api.net`) |

## Running

```bash
npm install
npm test          # vitest
npm run build
npm start         # requires Azure Functions Core Tools v4 and a real connection string in local.settings.json
```

No test environment was provided for either Service Bus or the vendor API, so the behaviour is verified with unit tests using mocks.

## Future improvements

- Implement the TODO tests listed in `test/setpoint.test.ts`.
- Stale/duplicate protection via a shared last-`eventTime` store per device.
- Managed identity for Service Bus; Key Vault reference for the API key.
- Structured logging/metrics (Application Insights) for sent, skipped, expired and failed counts, with alerts on `401` (bad key) and sustained `429`.
- Move the allowed-device list to configuration once it changes more often.
