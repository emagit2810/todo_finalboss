
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
}

export interface Medicine {
  id: string;
  name: string;
  dosage: string;
  taken: boolean;
  time: string; // e.g. "Morning", "Night"
}

export interface Expense {
  id: string;
  title: string; // Was 'description' or 'nombre'
  amount: number; // The raw value entered (weekly or monthly)
  frequency: 'weekly' | 'monthly';
  category: 'A' | 'B';
  date: number;
}

export enum ViewMode {
  LIST = 'LIST',
  CALENDAR = 'CALENDAR',
  BRAINSTORM = 'BRAINSTORM',
  MEDICINES = 'MEDICINES',
  EXPENSES = 'EXPENSES',
}

export interface AudioConfig {
  sampleRate: number;
}
