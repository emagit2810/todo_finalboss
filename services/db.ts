import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  Todo,
  Medicine,
  Expense,
  NoteDoc,
  NoteFolder,
  AppNotification,
  SyncQueueItem,
  SyncMetaItem,
  SyncStoreName,
  SyncAction,
} from '../types';

interface TaskMasterDB extends DBSchema {
  todos: {
    key: string;
    value: Todo;
  };
  deleted_todos: {
    key: string;
    value: Todo;
  };
  medicines: {
    key: string;
    value: Medicine;
  };
  expenses: {
    key: string;
    value: Expense;
  };
  note_folders: {
    key: string;
    value: NoteFolder;
  };
  notes: {
    key: string;
    value: NoteDoc;
  };
  attachments: {
    key: string;
    value: {
      id: string;
      blob: Blob;
      createdAt: number;
    };
  };
  notifications: {
    key: string;
    value: AppNotification;
  };
  ai_planner_results: {
    key: string;
    value: { id: string; query: string; resultText: string; timestamp: number };
  };
  sync_queue: {
    key: string;
    value: SyncQueueItem;
  };
  sync_meta: {
    key: string;
    value: SyncMetaItem;
  };
}

const DB_NAME = 'gemini-task-master';
const DB_VERSION = 5;

type StoreName = keyof TaskMasterDB;
type StoreValue<K extends StoreName> = TaskMasterDB[K]['value'];

export type DbWriteOptions = {
  skipSyncQueue?: boolean;
};

let dbPromise: Promise<IDBPDatabase<TaskMasterDB> | null> | null = null;
let dbFailed = false;
let fallbackWarned = false;

const FALLBACK_PREFIX = `tm_fallback:${DB_NAME}:`;
const memoryFallback = new Map<string, string>();

const SYNCABLE_STORE_NAMES = new Set<StoreName>([
  'todos',
  'notes',
  'note_folders',
  'expenses',
  'medicines',
]);

const warnFallbackOnce = (error: unknown) => {
  if (fallbackWarned) return;
  fallbackWarned = true;
  console.warn('IndexedDB unavailable, using localStorage fallback.', error);
};

const safeGetItem = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
};

const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
};

const safeRemoveItem = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    memoryFallback.delete(key);
  }
};

const readStore = <K extends StoreName>(storeName: K): Record<string, StoreValue<K>> => {
  const raw = safeGetItem(`${FALLBACK_PREFIX}${storeName}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, StoreValue<K>>;
  } catch {
    return {};
  }
};

const writeStore = <K extends StoreName>(storeName: K, data: Record<string, StoreValue<K>>) => {
  safeSetItem(`${FALLBACK_PREFIX}${storeName}`, JSON.stringify(data));
};

const fallbackGetAll = <K extends StoreName>(storeName: K): StoreValue<K>[] => {
  return Object.values(readStore(storeName));
};

const resolveFallbackKey = <K extends StoreName>(item: StoreValue<K>) => {
  const keyFromId = (item as { id?: string }).id;
  if (keyFromId) return keyFromId;
  const keyFromKey = (item as { key?: string }).key;
  if (keyFromKey) return keyFromKey;
  return crypto.randomUUID();
};

const fallbackPutItem = <K extends StoreName>(storeName: K, item: StoreValue<K>) => {
  const data = readStore(storeName);
  const key = resolveFallbackKey(item);
  data[key] = { ...(item as StoreValue<K>) };
  writeStore(storeName, data);
  return key;
};

const fallbackDeleteItem = <K extends StoreName>(storeName: K, id: string) => {
  const data = readStore(storeName);
  if (data[id]) {
    delete data[id];
    writeStore(storeName, data);
  } else {
    safeRemoveItem(`${FALLBACK_PREFIX}${storeName}`);
    writeStore(storeName, data);
  }
};

const toSyncStoreName = (storeName: StoreName): SyncStoreName | null => {
  if (storeName === 'todos') return 'todos';
  if (storeName === 'notes') return 'notes';
  if (storeName === 'note_folders') return 'note_folders';
  if (storeName === 'expenses') return 'expenses';
  if (storeName === 'medicines') return 'medicines';
  return null;
};

const shouldQueueSync = (storeName: StoreName, options?: DbWriteOptions) => {
  if (options?.skipSyncQueue) return false;
  return SYNCABLE_STORE_NAMES.has(storeName);
};

const enqueueSyncOperation = async (
  storeName: SyncStoreName,
  entityId: string,
  action: SyncAction,
  payload?: Record<string, any>,
  clientUpdatedAt = Date.now()
) => {
  const now = Date.now();
  const item: SyncQueueItem = {
    id: crypto.randomUUID(),
    opId: crypto.randomUUID(),
    storeName,
    entityId,
    action,
    payload,
    clientUpdatedAt,
    createdAt: now,
    attempts: 0,
    nextRetryAt: now,
    status: 'pending',
  };
  await putItem('sync_queue', item, { skipSyncQueue: true });
};

export const initDB = () => {
  if (dbFailed) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = openDB<TaskMasterDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('todos')) {
          db.createObjectStore('todos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('deleted_todos')) {
          db.createObjectStore('deleted_todos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('medicines')) {
          db.createObjectStore('medicines', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('expenses')) {
          db.createObjectStore('expenses', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('note_folders')) {
          db.createObjectStore('note_folders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('notifications')) {
          db.createObjectStore('notifications', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('ai_planner_results')) {
          db.createObjectStore('ai_planner_results', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
        }
      },
    }).catch((error) => {
      dbFailed = true;
      warnFallbackOnce(error);
      return null;
    });
  }
  return dbPromise;
};

export const getAll = async <K extends StoreName>(storeName: K): Promise<StoreValue<K>[]> => {
  const db = await initDB();
  if (!db) {
    return fallbackGetAll(storeName);
  }
  try {
    return await db.getAll(storeName as any);
  } catch (error) {
    dbFailed = true;
    warnFallbackOnce(error);
    return fallbackGetAll(storeName);
  }
};

export const putItem = async <K extends StoreName>(
  storeName: K,
  item: StoreValue<K>,
  options?: DbWriteOptions
) => {
  const db = await initDB();
  const key = resolveFallbackKey(item);

  if (!db) {
    fallbackPutItem(storeName, item);
  } else {
    try {
      await db.put(storeName as any, item);
    } catch (error) {
      dbFailed = true;
      warnFallbackOnce(error);
      fallbackPutItem(storeName, item);
    }
  }

  if (shouldQueueSync(storeName, options)) {
    const syncStoreName = toSyncStoreName(storeName);
    if (syncStoreName) {
      await enqueueSyncOperation(syncStoreName, key, 'upsert', item as Record<string, any>, Date.now());
    }
  }

  return key;
};

export const deleteItem = async <K extends StoreName>(storeName: K, id: string, options?: DbWriteOptions) => {
  const db = await initDB();
  if (!db) {
    fallbackDeleteItem(storeName, id);
  } else {
    try {
      await db.delete(storeName as any, id);
    } catch (error) {
      dbFailed = true;
      warnFallbackOnce(error);
      fallbackDeleteItem(storeName, id);
    }
  }

  if (shouldQueueSync(storeName, options)) {
    const syncStoreName = toSyncStoreName(storeName);
    if (syncStoreName) {
      await enqueueSyncOperation(syncStoreName, id, 'delete', undefined, Date.now());
    }
  }
};

export const softDeleteTodo = async (todo: Todo, options?: DbWriteOptions) => {
  const db = await initDB();
  if (!db) {
    const todos = readStore('todos');
    const deleted = readStore('deleted_todos');
    if (todos[todo.id]) {
      delete todos[todo.id];
      writeStore('todos', todos);
    }
    deleted[todo.id] = todo;
    writeStore('deleted_todos', deleted);
  } else {
    try {
      const tx = db.transaction(['todos', 'deleted_todos'], 'readwrite');
      await tx.objectStore('todos').delete(todo.id);
      await tx.objectStore('deleted_todos').put(todo);
      await tx.done;
    } catch (error) {
      dbFailed = true;
      warnFallbackOnce(error);
      const todos = readStore('todos');
      const deleted = readStore('deleted_todos');
      if (todos[todo.id]) {
        delete todos[todo.id];
        writeStore('todos', todos);
      }
      deleted[todo.id] = todo;
      writeStore('deleted_todos', deleted);
    }
  }

  if (!options?.skipSyncQueue) {
    await enqueueSyncOperation('todos', todo.id, 'delete', undefined, Date.now());
  }
};

export const saveAIResult = async (query: string, resultText: string) => {
    const payload = {
        id: crypto.randomUUID(),
        query,
        resultText,
        timestamp: Date.now()
    };
    const db = await initDB();
    if (!db) {
        fallbackPutItem('ai_planner_results', payload);
        return;
    }
    try {
        await db.put('ai_planner_results', payload);
    } catch (error) {
        dbFailed = true;
        warnFallbackOnce(error);
        fallbackPutItem('ai_planner_results', payload);
    }
};

const ATTACHMENT_DB_UNAVAILABLE = 'IndexedDB no disponible para guardar adjuntos.';

export const putAttachmentBlob = async (id: string, blob: Blob, options?: DbWriteOptions) => {
  const db = await initDB();
  if (!db) {
    throw new Error(ATTACHMENT_DB_UNAVAILABLE);
  }
  await db.put('attachments', {
    id,
    blob,
    createdAt: Date.now(),
  });
};

export const getAttachmentBlob = async (id: string): Promise<Blob | null> => {
  const db = await initDB();
  if (!db) {
    throw new Error(ATTACHMENT_DB_UNAVAILABLE);
  }
  const record = await db.get('attachments', id);
  return record?.blob || null;
};

export const deleteAttachmentBlob = async (id: string, options?: DbWriteOptions) => {
  const db = await initDB();
  if (!db) {
    throw new Error(ATTACHMENT_DB_UNAVAILABLE);
  }
  await db.delete('attachments', id);
};

export const listPendingSyncQueue = async () => {
  const items = await getAll('sync_queue');
  return items
    .filter((item) => item.status === 'pending' || item.status === 'failed')
    .sort((a, b) => a.createdAt - b.createdAt);
};

export const putSyncQueueItem = async (item: SyncQueueItem) => {
  return putItem('sync_queue', item, { skipSyncQueue: true });
};

export const deleteSyncQueueItem = async (id: string) => {
  return deleteItem('sync_queue', id, { skipSyncQueue: true });
};

export const getSyncMeta = async (key: string): Promise<string | null> => {
  const allMeta = await getAll('sync_meta');
  const found = allMeta.find((item) => item.key === key);
  return found?.value ?? null;
};

export const setSyncMeta = async (key: string, value: string) => {
  return putItem('sync_meta', { key, value, updatedAt: Date.now() }, { skipSyncQueue: true });
};
