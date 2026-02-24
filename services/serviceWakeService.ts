export type WakeServiceId = 'fastApi' | 'n8n';
export type WakeTrigger = 'manual' | 'auto';
export type WakeDispatchStatus = 'sent' | 'error';

export interface WakeServiceResult {
  serviceId: WakeServiceId;
  serviceLabel: string;
  url: string;
  status: WakeDispatchStatus;
  durationMs: number;
  error?: string;
}

export interface WakeBatchResult {
  trigger: WakeTrigger;
  attemptedAt: number;
  results: WakeServiceResult[];
}

interface WakeServiceTarget {
  id: WakeServiceId;
  label: string;
  url: string;
}

const DEFAULT_FASTAPI_HEALTH_URL = 'https://fast-api-v.onrender.com/healthz';
const DEFAULT_N8N_HEALTH_URL = 'https://n8n-service-ea3k.onrender.com/healthz';

const FASTAPI_HEALTH_URL =
  ((import.meta as any)?.env?.VITE_FASTAPI_HEALTH_URL || DEFAULT_FASTAPI_HEALTH_URL).trim();
const N8N_HEALTH_URL =
  ((import.meta as any)?.env?.VITE_N8N_HEALTH_URL || DEFAULT_N8N_HEALTH_URL).trim();

const WAKE_TARGETS: WakeServiceTarget[] = [
  { id: 'fastApi', label: 'Fast API', url: FASTAPI_HEALTH_URL },
  { id: 'n8n', label: 'N8N', url: N8N_HEALTH_URL },
];

const toErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'network_error';
};

export const pingServiceNoCors = async (
  url: string,
  timeoutMs = 10000
): Promise<Pick<WakeServiceResult, 'status' | 'durationMs' | 'error'>> => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return {
      status: 'sent',
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: toErrorMessage(error),
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

export const wakeServices = async (trigger: WakeTrigger, timeoutMs = 10000): Promise<WakeBatchResult> => {
  const attemptedAt = Date.now();
  const results = await Promise.all(
    WAKE_TARGETS.map(async (service): Promise<WakeServiceResult> => {
      const pingResult = await pingServiceNoCors(service.url, timeoutMs);
      return {
        serviceId: service.id,
        serviceLabel: service.label,
        url: service.url,
        status: pingResult.status,
        durationMs: pingResult.durationMs,
        error: pingResult.error,
      };
    })
  );

  return {
    trigger,
    attemptedAt,
    results,
  };
};
