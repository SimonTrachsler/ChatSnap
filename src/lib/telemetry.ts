import { supabase } from '@/lib/supabase';

const TELEMETRY_ENABLED = process.env.EXPO_PUBLIC_TELEMETRY_ENABLED !== 'false';
const MAX_EVENT_NAME_LENGTH = 120;
const MAX_TEXT_LENGTH = 3000;
const ERROR_DEDUPE_WINDOW_MS = 5_000;
let telemetrySchemaAvailable: boolean | null = null;

const recentErrorAtByKey = new Map<string, number>();

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function truncateText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}…` : value;
}

function normalizeError(error: unknown): { name: string; message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      name: truncateText(error.name || 'Error'),
      message: truncateText(error.message || 'Unknown error'),
      stack: error.stack ? truncateText(error.stack) : null,
    };
  }
  return {
    name: 'UnknownError',
    message: truncateText(typeof error === 'string' ? error : JSON.stringify(error ?? null)),
    stack: null,
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (value == null) return null;
  if (typeof value === 'string') return truncateText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonValue(val);
    }
    return out;
  }
  return truncateText(String(value));
}

function toJsonObject(value: Record<string, unknown> | undefined): Record<string, JsonValue> {
  if (!value) return {};
  const out: Record<string, JsonValue> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = toJsonValue(val);
  }
  return out;
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const res = await supabase.auth.getUser();
    return res.data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function insertTelemetryRow(table: 'analytics_events' | 'client_error_events', row: Record<string, unknown>): Promise<void> {
  if (telemetrySchemaAvailable === false) return;
  const query = supabase.from(table as never) as unknown as {
    insert: (value: Record<string, unknown>) => Promise<{ error: { message?: string; code?: string } | null }>;
  };
  const { error } = await query.insert(row);
  if (!error) {
    telemetrySchemaAvailable = true;
    return;
  }

  const msg = (error.message ?? '').toLowerCase();
  const code = (error.code ?? '').toLowerCase();
  const missingTable =
    msg.includes('could not find the table') ||
    msg.includes('does not exist') ||
    code === 'pgrst205' ||
    code === '42p01';
  if (missingTable) {
    telemetrySchemaAvailable = false;
    if (__DEV__) {
      console.warn('[telemetry] disabled because telemetry tables are missing on backend');
    }
    return;
  }

  if (__DEV__) {
    console.warn(`[telemetry] failed to insert into ${table}`, error.message);
  }
}

export async function trackEvent(eventName: string, properties?: Record<string, unknown>): Promise<void> {
  if (!TELEMETRY_ENABLED) return;
  const normalizedEventName = eventName.trim().slice(0, MAX_EVENT_NAME_LENGTH);
  if (!normalizedEventName) return;

  const userId = await getCurrentUserId();
  await insertTelemetryRow('analytics_events', {
    user_id: userId,
    event_name: normalizedEventName,
    properties: toJsonObject(properties),
  });
}

export async function reportError(
  context: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!TELEMETRY_ENABLED) return;
  const normalized = normalizeError(error);
  const normalizedContext = truncateText(context || 'unknown_context');

  const dedupeKey = `${normalizedContext}|${normalized.name}|${normalized.message}`;
  const now = Date.now();
  const lastAt = recentErrorAtByKey.get(dedupeKey) ?? 0;
  if (now - lastAt < ERROR_DEDUPE_WINDOW_MS) return;
  recentErrorAtByKey.set(dedupeKey, now);

  const userId = await getCurrentUserId();
  await insertTelemetryRow('client_error_events', {
    user_id: userId,
    context: normalizedContext,
    error_name: normalized.name,
    error_message: normalized.message,
    stack: normalized.stack,
    metadata: toJsonObject(metadata),
  });
}
