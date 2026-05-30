import * as localDb from './db';
import { SyncQueueItem, SyncStatsSnapshot, SyncStoreName } from '../types';

const SYNC_AUTH_STORAGE_KEY = 'todo_sync_auth_token';
const LAST_SYNC_META_KEY = 'backend_last_sync_at';
const BOOTSTRAP_META_KEY = 'backend_bootstrap_v1_done';

const DEFAULT_SYNC_INTERVAL_MS = 30_000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_LINEAR_RETRY_MS = 10_000;

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_SYNC_API_URL?.trim() ||
    import.meta.env.VITE_API_URL?.trim() ||
    ''
);

export const SYNC_INTERVAL_MS = parsePositiveInt(import.meta.env.VITE_SYNC_INTERVAL_MS, DEFAULT_SYNC_INTERVAL_MS);
const SYNC_MAX_RETRIES = parsePositiveInt(import.meta.env.VITE_SYNC_MAX_RETRIES, DEFAULT_MAX_RETRIES);
const SYNC_LINEAR_RETRY_MS = parsePositiveInt(import.meta.env.VITE_SYNC_LINEAR_RETRY_MS, DEFAULT_LINEAR_RETRY_MS);
const NOTE_SYNC_WINDOW_DAYS = parsePositiveInt(import.meta.env.VITE_NOTE_SYNC_WINDOW_DAYS, 92);
const NOTE_SYNC_WINDOW_MS = NOTE_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const storeToEntityType: Record<Exclude<SyncStoreName, 'attachments'>, string> = {
  todos: 'task',
  notes: 'note',
  note_folders: 'note_folder',
  expenses: 'expense',
  medicines: 'medicine',
};

const entityTypeToStore = (entityType: string): Exclude<SyncStoreName, 'attachments'> | null => {
  if (entityType === 'task') return 'todos';
  if (entityType === 'note') return 'notes';
  if (entityType === 'note_folder') return 'note_folders';
  if (entityType === 'expense') return 'expenses';
  if (entityType === 'medicine') return 'medicines';
  return null;
};

const syncStats: SyncStatsSnapshot = {
  queueSize: 0,
  syncErrors: 0,
  lastSyncLatencyMs: null,
  lastSyncAt: null,
  lastError: null,
};

const updateStats = (patch: Partial<SyncStatsSnapshot>) => {
  Object.assign(syncStats, patch);
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return 'unknown_sync_error';
};

const markSyncError = (error: unknown) => {
  const message = toErrorMessage(error);
  updateStats({
    syncErrors: syncStats.syncErrors + 1,
    lastError: message,
  });
  console.error('[sync:error]', message, error);
};

const clearSyncError = () => {
  updateStats({ lastError: null });
};

export const getSyncStatsSnapshot = (): SyncStatsSnapshot => ({ ...syncStats });

export const setSyncAuthToken = (token: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = token.trim();
  if (trimmed) {
    window.localStorage.setItem(SYNC_AUTH_STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(SYNC_AUTH_STORAGE_KEY);
  }
};

export const getSyncAuthToken = () => {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams(window.location.search);
  const tokenFromQuery = params.get('sync_token')?.trim();
  if (tokenFromQuery) {
    setSyncAuthToken(tokenFromQuery);
    return tokenFromQuery;
  }

  const fromStorage = window.localStorage.getItem(SYNC_AUTH_STORAGE_KEY)?.trim();
  if (fromStorage) return fromStorage;

  return (
    import.meta.env.VITE_SYNC_AUTH_TOKEN?.trim() ||
    import.meta.env.VITE_API_BEARER_TOKEN?.trim() ||
    ''
  );
};

export const isBackendSyncConfigured = () => !!API_BASE_URL && !!getSyncAuthToken();

const syncFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getSyncAuthToken();
  if (!API_BASE_URL) throw new Error('missing_sync_api_url');
  if (!token) throw new Error('missing_sync_auth_token');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`sync_http_${response.status}:${body.slice(0, 300)}`);
  }

  return (await response.json()) as T;
};

const resolveClientUpdatedAt = (item: Record<string, any>) => {
  if (typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)) return item.updatedAt;
  if (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)) return item.createdAt;
  if (typeof item.date === 'number' && Number.isFinite(item.date)) return item.date;
  if (typeof item.lastUpdated === 'number' && Number.isFinite(item.lastUpdated)) return item.lastUpdated;
  return Date.now();
};

const isRecentNoteRecord = (item: Record<string, any>) => {
  const timestamp = resolveClientUpdatedAt(item);
  return timestamp >= Date.now() - NOTE_SYNC_WINDOW_MS;
};

const enqueueBootstrapSnapshotIfNeeded = async () => {
  const alreadyBootstrapped = await localDb.getSyncMeta(BOOTSTRAP_META_KEY);
  if (alreadyBootstrapped === '1') return;

  const now = Date.now();
  const syncStores: Array<Exclude<SyncStoreName, 'attachments'>> = [
    'todos',
    'notes',
    'note_folders',
    'expenses',
    'medicines',
  ];

  for (const storeName of syncStores) {
    const records = await localDb.getAll(storeName as any);
    for (const record of records as Array<Record<string, any>>) {
      if (storeName === 'notes' && !isRecentNoteRecord(record)) continue;
      const entityId = String(record.id || '');
      if (!entityId) continue;
      await localDb.putSyncQueueItem({
        id: crypto.randomUUID(),
        opId: crypto.randomUUID(),
        storeName,
        entityId,
        action: 'upsert',
        payload: record,
        clientUpdatedAt: resolveClientUpdatedAt(record),
        createdAt: now,
        attempts: 0,
        nextRetryAt: now,
        status: 'pending',
      });
    }
  }

  await localDb.setSyncMeta(BOOTSTRAP_META_KEY, '1');
};

const buildEntityPush = (operation: SyncQueueItem) => ({
  op_id: operation.opId,
  entity_type: storeToEntityType[operation.storeName as Exclude<SyncStoreName, 'attachments'>],
  entity_id: operation.entityId,
  action: operation.action,
  data: operation.action === 'delete' ? undefined : operation.payload || {},
  client_updated_at: operation.clientUpdatedAt,
});

const pushOneOperation = async (operation: SyncQueueItem) => {
  if (operation.storeName === 'attachments') {
    // Blobs/images are intentionally excluded from Postgres/base64 sync.
    // They should move through S3/R2 object storage once that bucket is configured.
    return;
  }

  if (
    operation.storeName === 'notes' &&
    operation.action === 'upsert' &&
    operation.payload &&
    !isRecentNoteRecord(operation.payload)
  ) {
    return;
  }

  await syncFetch('/v1/sync/push', {
    method: 'POST',
    body: JSON.stringify({ operations: [buildEntityPush(operation)] }),
  });
};

const processQueue = async () => {
  const queueItems = await localDb.listPendingSyncQueue();
  updateStats({ queueSize: queueItems.length });

  const now = Date.now();
  for (const queueItem of queueItems) {
    if (queueItem.nextRetryAt > now) continue;

    try {
      await pushOneOperation(queueItem);
      await localDb.deleteSyncQueueItem(queueItem.id);
    } catch (error) {
      markSyncError(error);
      const attempts = queueItem.attempts + 1;
      const status = attempts >= SYNC_MAX_RETRIES ? 'dead_letter' : 'failed';
      await localDb.putSyncQueueItem({
        ...queueItem,
        attempts,
        status,
        nextRetryAt: now + attempts * SYNC_LINEAR_RETRY_MS,
        lastError: toErrorMessage(error),
      });
    }
  }

  const pendingAfter = await localDb.listPendingSyncQueue();
  updateStats({ queueSize: pendingAfter.length });
};

const pullIncremental = async (): Promise<Set<SyncStoreName>> => {
  const changedStores = new Set<SyncStoreName>();
  const since = (await localDb.getSyncMeta(LAST_SYNC_META_KEY)) || new Date(0).toISOString();
  const query = new URLSearchParams({ since });

  const result = await syncFetch<{
    entities: Array<{
      entity_type: string;
      entity_id: string;
      data: Record<string, any>;
      deleted: boolean;
    }>;
    attachments: Array<{
      attachment_id: string;
      mime_type?: string;
      data_base64?: string | null;
      deleted: boolean;
    }>;
    next_since?: string;
  }>(`/v1/sync/pull?${query.toString()}`);

  for (const entity of result.entities || []) {
    const storeName = entityTypeToStore(entity.entity_type);
    if (!storeName) continue;

    if (entity.deleted) {
      await localDb.deleteItem(storeName, entity.entity_id, { skipSyncQueue: true });
    } else {
      const payload = { ...(entity.data || {}), id: entity.data?.id || entity.entity_id };
      if (storeName === 'notes' && !isRecentNoteRecord(payload)) continue;
      await localDb.putItem(storeName, payload as any, { skipSyncQueue: true });
    }

    changedStores.add(storeName);
  }

  // Attachment blobs are skipped in phase 1; use R2/S3 object storage for files/images.

  if (result.next_since) {
    await localDb.setSyncMeta(LAST_SYNC_META_KEY, result.next_since);
  }

  return changedStores;
};

export const forceSyncNow = async (reason: string = 'manual') => {
  const startedAt = Date.now();
  const changedStores = new Set<SyncStoreName>();

  try {
    if (!isBackendSyncConfigured()) {
      updateStats({
        queueSize: 0,
        lastSyncLatencyMs: Date.now() - startedAt,
        lastSyncAt: Date.now(),
        lastError: !API_BASE_URL ? 'missing_sync_api_url' : 'missing_sync_auth_token',
      });
      return { changedStores, stats: getSyncStatsSnapshot() };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      updateStats({
        lastSyncLatencyMs: Date.now() - startedAt,
        lastSyncAt: Date.now(),
        lastError: 'offline',
      });
      return { changedStores, stats: getSyncStatsSnapshot() };
    }

    await enqueueBootstrapSnapshotIfNeeded();
    await processQueue();

    const pulledStores = await pullIncremental();
    pulledStores.forEach((storeName) => changedStores.add(storeName));

    clearSyncError();
    updateStats({
      lastSyncLatencyMs: Date.now() - startedAt,
      lastSyncAt: Date.now(),
    });

    console.info('[sync:ok]', {
      reason,
      changedStores: Array.from(changedStores.values()),
      queueSize: syncStats.queueSize,
      latencyMs: syncStats.lastSyncLatencyMs,
    });

    return { changedStores, stats: getSyncStatsSnapshot() };
  } catch (error) {
    markSyncError(error);
    updateStats({
      lastSyncLatencyMs: Date.now() - startedAt,
      lastSyncAt: Date.now(),
    });
    console.error('[sync:failed]', { reason, error });
    return { changedStores, stats: getSyncStatsSnapshot() };
  }
};
