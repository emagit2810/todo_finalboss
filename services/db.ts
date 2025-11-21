import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Todo, Medicine, Expense } from '../types';

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
  ai_planner_results: {
    key: string;
    value: { id: string; query: string; resultText: string; timestamp: number };
  };
}

const DB_NAME = 'gemini-task-master';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TaskMasterDB>>;

export const initDB = () => {
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
        if (!db.objectStoreNames.contains('ai_planner_results')) {
          db.createObjectStore('ai_planner_results', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

// --- Generic Helpers ---

export const getAll = async <K extends keyof TaskMasterDB>(storeName: K): Promise<TaskMasterDB[K]['value'][]> => {
  const db = await initDB();
  return db.getAll(storeName as any);
};

export const putItem = async <K extends keyof TaskMasterDB>(storeName: K, item: TaskMasterDB[K]['value']) => {
  const db = await initDB();
  return db.put(storeName as any, item);
};

export const deleteItem = async <K extends keyof TaskMasterDB>(storeName: K, id: string) => {
  const db = await initDB();
  return db.delete(storeName as any, id);
};

// --- Specific Logic (if needed) ---

export const softDeleteTodo = async (todo: Todo) => {
    const db = await initDB();
    const tx = db.transaction(['todos', 'deleted_todos'], 'readwrite');
    await tx.objectStore('todos').delete(todo.id);
    await tx.objectStore('deleted_todos').put(todo);
    return tx.done;
};

export const saveAIResult = async (query: string, resultText: string) => {
    const db = await initDB();
    await db.put('ai_planner_results', {
        id: crypto.randomUUID(),
        query,
        resultText,
        timestamp: Date.now()
    });
}