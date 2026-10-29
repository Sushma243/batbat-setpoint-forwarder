export interface IncomingSetpoint {
  device_id: string;
  setpoint: {
    value: number;
    unit: 'kW';
    endTime: string;
  };
  eventTime: string;
}

export interface BatterySetpointPayload {
  startTime: number;
  endTime: number;
  value: number;
}

// The API requires startTime to be in the future; a small offset absorbs clock skew and latency.
const START_OFFSET_SECONDS = 1;

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function decode(raw: unknown): unknown {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  if (typeof text !== 'string') return text;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function parseSetpoint(raw: unknown): IncomingSetpoint | null {
  const msg = decode(raw);
  if (!isRecord(msg) || !isRecord(msg.setpoint)) return null;

  const { device_id, eventTime } = msg;
  const { value, unit, endTime } = msg.setpoint;
  if (
    typeof device_id !== 'string' ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    unit !== 'kW' ||
    !isIsoDate(endTime) ||
    !isIsoDate(eventTime)
  ) {
    return null;
  }
  return { device_id, eventTime, setpoint: { value, unit, endTime } };
}

// Incoming values are kW from the grid perspective (positive = discharge);
// the API expects whole watts from the battery perspective (positive = charge).
export function toBatteryPayload(sp: IncomingSetpoint, nowMs: number): BatterySetpointPayload {
  return {
    startTime: Math.ceil(nowMs / 1000) + START_OFFSET_SECONDS,
    endTime: Math.floor(Date.parse(sp.setpoint.endTime) / 1000),
    value: Math.round(-sp.setpoint.value * 1000) || 0,
  };
}

// Devices hold a single setpoint and newer ones override older ones, so only the latest per device matters.
export function latestPerDevice(setpoints: IncomingSetpoint[]): IncomingSetpoint[] {
  const latest = new Map<string, IncomingSetpoint>();
  for (const sp of setpoints) {
    const current = latest.get(sp.device_id);
    if (!current || Date.parse(sp.eventTime) >= Date.parse(current.eventTime)) {
      latest.set(sp.device_id, sp);
    }
  }
  return [...latest.values()];
}
