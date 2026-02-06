
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export interface Subtask {
  id: string;
  text: string;
  completed: boolean;
}

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
  category?: string;
  priority: Priority;
  description?: string;
  complexity?: number; // 1-10
  subtasks?: Subtask[];
  dueDate?: number; // Timestamp
  linkedNotes?: string[];
}

export interface Medicine {
  id: string;
  name: string;
  dosage: string;
  taken: boolean;
  remaining: number; // days of medicine left
  lastUpdated?: number; // start-of-day timestamp to track daily decrement
  alarmEnabled?: boolean; // show refill alerts on calendar
}

export interface Expense {
  id: string;
  title: string; // Was 'description' or 'nombre'
  amount: number; // The raw value entered (weekly or monthly)
  frequency: 'weekly' | 'monthly';
  category: 'A' | 'B';
  date: number;
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
  locked?: boolean;
  lockSalt?: string;
  lockHash?: string;
  lockIterations?: number;
}

export interface NoteDoc {
  id: string;
  title: string;
  content?: string;
  folderId?: string | null;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  locked?: boolean;
  encryptedContent?: string;
  iv?: string;
  salt?: string;
  lockHash?: string;
  lockIterations?: number;
}

export type NotificationSource = 'todo' | 'reminder' | 'medicine' | 'expense';

export type NotificationKind =
  | 'todo-due'
  | 'medicine-refill-soon'
  | 'medicine-refill-end'
  | 'expense-due';

export interface AppNotification {
  id: string;
  message: string;
  source: NotificationSource;
  kind?: NotificationKind;
  scheduledAt: number;
  createdAt: number;
  read: boolean;
  todoId?: string;
  entityId?: string;
}

export enum ViewMode {
  LIST = 'LIST',
  CALENDAR = 'CALENDAR',
  BRAINSTORM = 'BRAINSTORM',
  MEDICINES = 'MEDICINES',
  EXPENSES = 'EXPENSES',
  NOTES = 'NOTES',
}

export interface AudioConfig {
  sampleRate: number;
}
