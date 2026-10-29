export const SETPOINT_QUEUE = 'sbq-batbat-spt';
export const SERVICE_BUS_CONNECTION = 'CONNECTION-STRING-SBQ-BATBAT-SPT';

export const ALLOWED_DEVICES: ReadonlySet<string> = new Set([
  'BB00001',
  'BB00005',
  'BB00006',
  'BB00007',
  'BB00293',
]);

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const apiKey = env.BATBAT_API_KEY;
  if (!apiKey) {
    throw new Error('BATBAT_API_KEY is not configured');
  }
  return {
    baseUrl: env.BATBAT_API_URL ?? 'https://BatB.azure-api.net',
    apiKey,
    timeoutMs: 10_000,
  };
}
