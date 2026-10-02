import type { TwinSession } from "./TwinSession";

export interface Env {
  TWIN_SESSIONS: DurableObjectNamespace<TwinSession>;
  TWIN_RELAY_SECRET_KEY: string;
  SESSION_CREATE_LIMITER: RateLimit;
  TWIN_RELAY_SESSION_TTL_SECONDS?: string;
  TWIN_RELAY_MAX_EVENTS?: string;
  TWIN_RELAY_MAX_COMMENTS?: string;
}

export function intEnv(
  value: string | undefined,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
