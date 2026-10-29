import axios, { AxiosInstance } from 'axios';
import { ApiConfig } from './config';
import { IncomingSetpoint, toBatteryPayload } from './setpoint';

export type SendResult = 'sent' | 'expired';

export interface SetpointSender {
  sendSetpoint(setpoint: IncomingSetpoint): Promise<SendResult>;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 15_000 };
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class BatteryApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BatteryApiError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BatteredBatteriesClient implements SetpointSender {
  constructor(
    private readonly http: AxiosInstance,
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {}

  static fromConfig(config: ApiConfig): BatteredBatteriesClient {
    return new BatteredBatteriesClient(
      axios.create({
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        headers: { 'Ocp-Apim-Subscription-Key': config.apiKey, 'Content-Type': 'application/json' },
      }),
    );
  }

  async sendSetpoint(setpoint: IncomingSetpoint): Promise<SendResult> {
    for (let attempt = 1; ; attempt++) {
      // Rebuilt on every attempt so startTime stays in the future after backoff.
      const payload = toBatteryPayload(setpoint, this.now());
      if (payload.endTime <= payload.startTime) return 'expired';

      try {
        await this.http.post(`/${encodeURIComponent(setpoint.device_id)}/setpoint`, { data: payload });
        return 'sent';
      } catch (err) {
        const apiError = toApiError(err);
        if (!apiError.retryable || attempt >= this.retry.maxAttempts) throw apiError;
        await this.sleep(this.retryDelayMs(err, attempt));
      }
    }
  }

  private retryDelayMs(err: unknown, attempt: number): number {
    const retryAfterSeconds = Number(axios.isAxiosError(err) ? err.response?.headers?.['retry-after'] : NaN);
    const delay = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : this.retry.baseDelayMs * 2 ** (attempt - 1) + Math.random() * this.retry.baseDelayMs;
    return Math.min(delay, this.retry.maxDelayMs);
  }
}

// Never wrap the raw axios error: its config carries the API key header.
function toApiError(err: unknown): BatteryApiError {
  if (!axios.isAxiosError(err)) {
    return new BatteryApiError('Unexpected error calling Battered Batteries API', undefined, false);
  }
  const status = err.response?.status;
  const retryable = status === undefined || RETRYABLE_STATUSES.has(status);
  const reason = status === undefined ? `network error (${err.code ?? 'unknown'})` : `status ${status}`;
  return new BatteryApiError(`Battered Batteries API request failed: ${reason}`, status, retryable);
}
