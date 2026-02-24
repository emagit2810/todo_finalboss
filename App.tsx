
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Todo, ViewMode, Medicine, Expense, Priority, Subtask, NoteDoc, NoteFolder, AppNotification, AttachmentMeta } from './types';
import { TodoItem } from './components/TodoItem';
import { brainstormTasks } from './services/geminiService';
import { PlusIcon, BrainIcon, ArrowsExpandIcon, ArrowsCollapseIcon, FlagIcon, BellIcon, ClockIcon, DocumentIcon, XMarkIcon } from './components/Icons';
import { MedicinePanel } from './components/MedicinePanel';
import { ExpensesPanel } from './components/ExpensesPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { NotesPanel } from './components/NotesPanel';
import { Sidebar } from './components/Sidebar';
import * as db from './services/db';
import { sendReminder, sendDailyTopNow, tryOpenWhatsAppLink, syncDailyTopSnapshot, type DailyTopTaskSnapshot } from './services/reminderService';
import { Toast } from './components/Toast';
import { VoiceDictation } from './components/VoiceDictation';
import { buildMedicineAlerts } from './utils/medicineAlerts';

type NotificationFilter = 'today' | 'tomorrow' | 'week';
type DropTarget =
  | { type: 'todo'; id: string }
  | { type: 'note'; id: string }
  | { type: 'new_todo_input' };

type ReminderOptions = {
  sendToApi: boolean;
  openWhatsApp: boolean;
  createTaskFromResponse: boolean;
  localNotification: boolean;
};

const MS_MINUTE = 60 * 1000;
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * 60 * 60 * 1000;
const HIGH_EXPENSE_THRESHOLD = 50000;
const NOTIFICATION_WINDOW_DAYS = 6;
const DAILY_TOP_TZ = 'America/Bogota';
const DAILY_TOP_SYNC_DEBOUNCE_MS = 1200;
const DAILY_TOP_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_ENTITY = 5;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'txt', 'doc', 'docx']);
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
]);

const DAILY_TOP_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TOP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DAILY_TOP_PRIORITY_WEIGHT: Record<Priority, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

const getDayStartTs = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const isExpenseDueOnDay = (expense: Expense, dayStartTs: number) => {
  const anchorDayStart = getDayStartTs(expense.date);
  if (dayStartTs < anchorDayStart) return false;

  if (expense.frequency === 'weekly') {
    const diffDays = Math.round((dayStartTs - anchorDayStart) / MS_DAY);
    return diffDays % 7 === 0;
  }

  const anchorDate = new Date(anchorDayStart);
  const targetDate = new Date(dayStartTs);
  const lastDayOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
  const expectedDay = Math.min(anchorDate.getDate(), lastDayOfMonth);
  return targetDate.getDate() === expectedDay;
};

const getNotificationSourceLabel = (source: AppNotification['source']) => {
  if (source === 'todo') return 'Tarea';
  if (source === 'reminder') return 'Recordatorio';
  if (source === 'medicine') return 'Medicina';
  return 'Gasto';
};

const toBogotaDateKey = (timestamp: number) => DAILY_TOP_DATE_FMT.format(new Date(timestamp));

const buildDailyTop5Snapshot = (todos: Todo[], nowTs: number): DailyTopTaskSnapshot[] => {
  const todayKey = toBogotaDateKey(nowTs);

  const candidate = todos.filter(todo => {
    if (todo.completed) return false;
    if (!todo.dueDate) return false;
    return toBogotaDateKey(todo.dueDate) <= todayKey;
  });

  const ordered = [...candidate].sort((a, b) => {
    const pa = DAILY_TOP_PRIORITY_WEIGHT[a.priority || 'P4'];
    const pb = DAILY_TOP_PRIORITY_WEIGHT[b.priority || 'P4'];
    if (pa !== pb) return pa - pb;

    const na = Math.max(1, Math.round(a.complexity || 1));
    const nb = Math.max(1, Math.round(b.complexity || 1));
    if (na !== nb) return na - nb;

    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  return ordered.slice(0, 5).map(todo => ({
    id: todo.id,
    title: (todo.text || '').trim(),
    priority: todo.priority || 'P4',
    number: Math.max(1, Math.round(todo.complexity || 1)),
    due_date: todo.dueDate ? toBogotaDateKey(todo.dueDate) : null,
  }));
};

const serializeDailyTop5 = (top5: DailyTopTaskSnapshot[]) =>
  JSON.stringify(top5.map(item => [item.id, item.title, item.priority, item.number, item.due_date || null]));

const sanitizeAttachmentName = (rawName: string) => {
  const cleaned = rawName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
  return cleaned.length > 0 ? cleaned : 'archivo';
};

const getFileExtension = (name: string) => {
  const clean = name.trim().toLowerCase();
  const dotIndex = clean.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === clean.length - 1) return '';
  return clean.slice(dotIndex + 1);
};

const validateAttachmentFile = (file: File) => {
  const extension = getFileExtension(file.name);
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { valid: false, reason: `Tipo no permitido: ${file.name}` };
  }
  if (file.size <= 0) {
    return { valid: false, reason: `Archivo vacio: ${file.name}` };
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return { valid: false, reason: `Excede 20MB: ${file.name}` };
  }
  const fileType = (file.type || '').toLowerCase();
  if (fileType && !ALLOWED_ATTACHMENT_MIME_TYPES.has(fileType)) {
    return { valid: false, reason: `MIME no permitido (${fileType}): ${file.name}` };
  }
  return { valid: true, reason: '' };
};

function App() {
  // --- State: Todos ---
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filterPriority, setFilterPriority] = useState<Priority | 'ALL'>('ALL');
  
  // --- State: Medicines ---
  const [medicines, setMedicines] = useState<Medicine[]>([]);

  // --- State: Expenses ---
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // --- State: Notes ---
  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [noteFolders, setNoteFolders] = useState<NoteFolder[]>([]);

  // --- State: UI ---
  const [inputValue, setInputValue] = useState('');
  const [inputPriority, setInputPriority] = useState<Priority>('P4'); // Default priority for new task
  const [inputDueDate, setInputDueDate] = useState(''); // YYYY-MM-DD string
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.LIST);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const quickNoteInFlightRef = useRef(false);
  const lastDailyTopHashRef = useRef('');
  const lastDailyTopAttemptHashRef = useRef('');
  const lastDailyTopAttemptAtRef = useRef(0);
  const [brainstormQuery, setBrainstormQuery] = useState('');
  const [brainstormLoading, setBrainstormLoading] = useState(false);
  const [brainstormSources, setBrainstormSources] = useState<Array<{uri: string, title: string}>>([]);
  
  // State for note linking on task creation
  const [isNoteLinkerOpen, setIsNoteLinkerOpen] = useState(false);
  const [noteLinkQuery, setNoteLinkQuery] = useState('');

  // State for attachment drag/drop
  const dragDepthRef = useRef(0);
  const lastAttachmentTargetRef = useRef<DropTarget | null>(null);
  const [isDragOverlayVisible, setIsDragOverlayVisible] = useState(false);
  const [dragTargetPreview, setDragTargetPreview] = useState<DropTarget | null>(null);
  const [dropProcessing, setDropProcessing] = useState(false);

  // --- State: Reminder / Notification ---
  const [isReminderPanelOpen, setIsReminderPanelOpen] = useState(false);
  const [reminderText, setReminderText] = useState('');
  const [reminderEdited, setReminderEdited] = useState(false);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [dailyTopSendLoading, setDailyTopSendLoading] = useState(false);
  const [localReminderMode, setLocalReminderMode] = useState<'hours' | 'days' | 'minute'>('hours');
  const [localReminderHours, setLocalReminderHours] = useState(3);
  const [localReminderDays, setLocalReminderDays] = useState(1);
  const [reminderOptions, setReminderOptions] = useState<ReminderOptions>({
    sendToApi: true,
    openWhatsApp: false,
    createTaskFromResponse: false,
    localNotification: false,
  });
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error', sticky?: boolean } | null>(null);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>('today');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());
  const notificationWindowStartTs = useMemo(() => getDayStartTs(nowTs), [nowTs]);
  const dailyTop5 = useMemo(() => buildDailyTop5Snapshot(todos, nowTs), [todos, nowTs]);

  // --- Initialization (Load from IndexedDB) ---
  useEffect(() => {
    const loadData = async () => {
        try {
            // Load Todos
            const loadedTodos = await db.getAll('todos');
            setTodos(loadedTodos.sort((a, b) => b.createdAt - a.createdAt));

            // Load Medicines
            const loadedMedicines = await db.getAll('medicines');
            const todayStart = getDayStartTs(Date.now());
            const normalizedMedicines: Medicine[] = [];
            const medicinesToUpdate: Medicine[] = [];

            for (const med of loadedMedicines) {
                const lastUpdated = med.lastUpdated ?? todayStart;
                const remaining = Number.isFinite(med.remaining) ? med.remaining : 30;
                const daysPassed = Math.max(0, Math.floor((todayStart - lastUpdated) / MS_DAY));
                const nextRemaining = Math.max(0, remaining - daysPassed);
                const alarmEnabled = med.alarmEnabled ?? false;
                const updatedMed = {
                    ...med,
                    remaining: nextRemaining,
                    lastUpdated: todayStart,
                    alarmEnabled,
                };
                normalizedMedicines.push(updatedMed);

                if (
                    nextRemaining !== remaining ||
                    lastUpdated !== todayStart ||
                    med.remaining === undefined ||
                    med.alarmEnabled === undefined
                ) {
                    medicinesToUpdate.push(updatedMed);
                }
            }

            setMedicines(normalizedMedicines);
            for (const med of medicinesToUpdate) {
                await db.putItem('medicines', med);
            }

            // Load Expenses
            let loadedExpenses = await db.getAll('expenses');
            
            // Seed initial expenses if empty (Migration/First Run)
            if (loadedExpenses.length === 0) {
                const seedData: Partial<Expense>[] = [
                  { title: 'Café', amount: 20000, category: 'A', frequency: 'weekly' },
                  { title: 'Metro', amount: 30000, category: 'A', frequency: 'weekly' },
                  { title: 'Cuaderno', amount: 5000, category: 'A', frequency: 'monthly' },
                  { title: 'Acetaminofén', amount: 2000, category: 'A', frequency: 'monthly' },
                  { title: 'Esferos', amount: 4000, category: 'A', frequency: 'monthly' },
                  { title: 'Frutas', amount: 15000, category: 'B', frequency: 'weekly' },
                  { title: 'Huevos', amount: 5600, category: 'B', frequency: 'weekly' },
                  { title: 'Papel higiénico', amount: 3000, category: 'B', frequency: 'weekly' },
                  { title: 'Jabón', amount: 7000, category: 'B', frequency: 'monthly' },
                  { title: 'Medicina', amount: 90000, category: 'B', frequency: 'weekly' },
                  { title: 'Cuchillas afeitar', amount: 8000, category: 'B', frequency: 'monthly' },
                  { title: 'Galletas', amount: 8000, category: 'B', frequency: 'weekly' },
                  { title: 'Nueces integrales', amount: 7500, category: 'B', frequency: 'weekly' }
                ];
                
                for (const item of seedData) {
                    const newExp: Expense = {
                        id: crypto.randomUUID(),
                        title: item.title!,
                        amount: item.amount!,
                        category: item.category as 'A' | 'B',
                        frequency: item.frequency as 'weekly' | 'monthly',
                        date: Date.now()
                    };
                    await db.putItem('expenses', newExp);
                    loadedExpenses.push(newExp);
                }
            }
            setExpenses(loadedExpenses);

            // Load Notes + Folders
            const loadedFolders = await db.getAll('note_folders');
            setNoteFolders(loadedFolders);
            const loadedNotes = await db.getAll('notes');
            const sortedNotes = loadedNotes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            setNotes(sortedNotes);

            const loadedNotifications = await db.getAll('notifications');
            setNotifications(loadedNotifications);
        } catch (error) {
            console.error("Failed to load data from DB", error);
        } finally {
            setNotificationsReady(true);
        }
    };
    loadData();
  }, []);

  // --- Handlers: Todos ---
  const addTodo = useCallback(async (
    text: string,
    priority: Priority = 'P4',
    dateOverride?: number,
    linkedNoteId?: string,
    attachments?: AttachmentMeta[],
  ) => {
    if (!text.trim()) return;
    
    const now = Date.now();
    const resolvedDueDate = dateOverride ?? (inputDueDate ? (() => {
      const [y, m, d] = inputDueDate.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0).getTime();
    })() : undefined);
    const newTodo: Todo = {
        id: crypto.randomUUID(),
        text: text.trim(),
        completed: false,
        createdAt: now,
        priority,
        dueDate: resolvedDueDate,
        linkedNotes: linkedNoteId ? [linkedNoteId] : undefined,
        attachments: attachments && attachments.length ? attachments : undefined,
    };

    // Optimistic
    setTodos(prev => [newTodo, ...prev]);
    setInputValue('');
    setInputPriority('P4'); // Reset to default
    setInputDueDate(''); // Reset date
    setReminderText(''); // Reset reminder
    setReminderEdited(false);
    setIsReminderPanelOpen(false);
    setIsNoteLinkerOpen(false);
    setNoteLinkQuery('');
    
    // DB Update
    try {
      await db.putItem('todos', newTodo);
    } catch (error) {
      setTodos((prev) => prev.filter((todo) => todo.id !== newTodo.id));
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          try {
            await db.deleteAttachmentBlob(attachment.id);
          } catch (cleanupError) {
            console.error('No se pudo limpiar adjunto tras fallo al crear tarea', cleanupError);
          }
        }
      }
      throw error;
    }
  }, [inputDueDate]);

  const handleUpdateTodo = useCallback(async (updatedTodo: Todo) => {
      setTodos(prev => prev.map(t => t.id === updatedTodo.id ? updatedTodo : t));
      await db.putItem('todos', updatedTodo);
  }, []);

  const deleteTodo = useCallback(async (id: string) => {
    const todoToDelete = todos.find(t => t.id === id);
    
    // Optimistic
    setTodos(prev => prev.filter(t => t.id !== id));

    // DB Update (Soft Delete)
    if (todoToDelete) {
        const attachmentIds = (todoToDelete.attachments || []).map((attachment) => attachment.id);
        await db.softDeleteTodo(todoToDelete);
        for (const attachmentId of attachmentIds) {
          try {
            await db.deleteAttachmentBlob(attachmentId);
          } catch (error) {
            console.error('No se pudo borrar adjunto de tarea', error);
          }
        }
    }
  }, [todos]);

  const handleOpenNote = useCallback((noteId: string) => {
    setOpenNoteId(noteId);
    setViewMode(ViewMode.NOTES);
  }, []);

  const consumeOpenNoteId = useCallback(() => {
    setOpenNoteId(null);
  }, []);

  const parseSubtasksFromText = (text: string): Subtask[] => {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const newSubtasks: Subtask[] = [];
    for (const line of lines) {
      const cleanText = line.replace(/^[\d\.\-\*\s]+/, '').trim();
      if (cleanText && cleanText.length > 2) {
        newSubtasks.push({
          id: crypto.randomUUID(),
          text: cleanText,
          completed: false
        });
      }
    }
    return newSubtasks;
  };

  const openReminderPanel = useCallback(() => {
    setIsReminderPanelOpen(true);
    setReminderEdited(false);
    setReminderText(inputValue);
  }, [inputValue]);

  const closeReminderPanel = useCallback(() => {
    setIsReminderPanelOpen(false);
    setReminderEdited(false);
  }, []);

  const toggleNotificationCenter = () => {
    setNotificationCenterOpen((prev) => {
      const next = !prev;
      if (next) {
        setNotificationFilter('today');
      }
      return next;
    });
  };

  const createLocalNotification = useCallback(async (message: string, scheduledAt: number) => {
    const newItem: AppNotification = {
      id: crypto.randomUUID(),
      message,
      source: 'reminder',
      scheduledAt,
      createdAt: Date.now(),
      read: false,
    };
    setNotifications(prev => [newItem, ...prev]);
    await db.putItem('notifications', newItem);
  }, []);

  const toggleNotificationRead = (item: AppNotification) => {
    const nextRead = !item.read;
    setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: nextRead } : n));
    db.putItem('notifications', { ...item, read: nextRead });
  };

  const updateReminderOption = (key: keyof ReminderOptions, checked: boolean) => {
    setReminderOptions(prev => ({ ...prev, [key]: checked }));
  };

  useEffect(() => {
    if (!notificationsReady) return;
    let cancelled = false;

    const syncGeneratedNotifications = async () => {
      const existingMap = new Map(notifications.map(n => [n.id, n]));
      const nextNotifications = [...notifications];
      const keepIds = new Set<string>();
      const updates: AppNotification[] = [];
      const deletions: string[] = [];
      const windowDayStarts = Array.from(
        { length: NOTIFICATION_WINDOW_DAYS + 1 },
        (_, offset) => notificationWindowStartTs + offset * MS_DAY
      );

      const upsertLocal = (item: AppNotification) => {
        const idx = nextNotifications.findIndex(n => n.id === item.id);
        if (idx === -1) {
          nextNotifications.unshift(item);
        } else {
          nextNotifications[idx] = item;
        }
      };

      const upsertGenerated = (base: AppNotification) => {
        keepIds.add(base.id);
        const existing = existingMap.get(base.id);

        if (!existing) {
          upsertLocal(base);
          updates.push(base);
          return;
        }

        const nextItem: AppNotification = {
          ...existing,
          ...base,
          read: existing.read,
          createdAt: existing.createdAt ?? base.createdAt,
        };

        const needsUpdate =
          existing.message !== nextItem.message ||
          existing.scheduledAt !== nextItem.scheduledAt ||
          existing.source !== nextItem.source ||
          existing.todoId !== nextItem.todoId ||
          existing.entityId !== nextItem.entityId ||
          existing.kind !== nextItem.kind;

        if (needsUpdate) {
          upsertLocal(nextItem);
          updates.push(nextItem);
        }
      };

      todos.forEach(todo => {
        if (!todo.dueDate || todo.completed) return;
        const id = `todo:${todo.id}`;
        const scheduledAt = getDayStartTs(todo.dueDate);
        const base: AppNotification = {
          id,
          message: todo.text,
          source: 'todo',
          kind: 'todo-due',
          scheduledAt,
          createdAt: todo.createdAt ?? Date.now(),
          todoId: todo.id,
          entityId: todo.id,
          read: false,
        };
        upsertGenerated(base);
      });

      const medicineAlerts = buildMedicineAlerts(medicines, notificationWindowStartTs);
      medicineAlerts.forEach((alert) => {
        const scheduledAt = getDayStartTs(alert.scheduledAt);
        const offset = Math.round((scheduledAt - notificationWindowStartTs) / MS_DAY);
        if (offset < 0 || offset > NOTIFICATION_WINDOW_DAYS) return;

        const id = `medicine:${alert.medicineId}:${alert.kind}:${scheduledAt}`;
        const base: AppNotification = {
          id,
          message: alert.label,
          source: 'medicine',
          kind: alert.kind === 'refill-end' ? 'medicine-refill-end' : 'medicine-refill-soon',
          scheduledAt,
          createdAt: Date.now(),
          read: false,
          entityId: alert.medicineId,
        };
        upsertGenerated(base);
      });

      expenses.forEach((expense) => {
        if (!Number.isFinite(expense.amount) || expense.amount < HIGH_EXPENSE_THRESHOLD) return;
        windowDayStarts.forEach((dayStartTs) => {
          if (!isExpenseDueOnDay(expense, dayStartTs)) return;

          const id = `expense:${expense.id}:due:${dayStartTs}`;
          const amountLabel = Math.round(expense.amount).toLocaleString('es-CO');
          const base: AppNotification = {
            id,
            message: `${expense.title} due ($${amountLabel})`,
            source: 'expense',
            kind: 'expense-due',
            scheduledAt: dayStartTs,
            createdAt: Date.now(),
            read: false,
            entityId: expense.id,
          };
          upsertGenerated(base);
        });
      });

      notifications.forEach(item => {
        if (item.source === 'reminder') return;
        if (!keepIds.has(item.id)) {
          deletions.push(item.id);
        }
      });

      if (updates.length > 0 || deletions.length > 0) {
        const toDeleteSet = new Set(deletions);
        const filtered = nextNotifications.filter(n => !toDeleteSet.has(n.id));
        if (!cancelled) {
          setNotifications(filtered);
        }
      }

      for (const item of updates) {
        await db.putItem('notifications', item);
      }
      for (const id of deletions) {
        await db.deleteItem('notifications', id);
      }
    };

    syncGeneratedNotifications();
    return () => {
      cancelled = true;
    };
  }, [expenses, medicines, notificationWindowStartTs, notifications, notificationsReady, todos]);

  useEffect(() => {
    if (!isReminderPanelOpen) return;
    if (reminderEdited) return;
    if (reminderText !== inputValue) {
      setReminderText(inputValue);
    }
  }, [inputValue, isReminderPanelOpen, reminderEdited, reminderText]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTs(Date.now());
    }, 10000);
    const handleFocus = () => setNowTs(Date.now());
    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    const nextHash = serializeDailyTop5(dailyTop5);
    if (nextHash === lastDailyTopHashRef.current) return;
    if (
      nextHash === lastDailyTopAttemptHashRef.current &&
      Date.now() - lastDailyTopAttemptAtRef.current < DAILY_TOP_RETRY_COOLDOWN_MS
    ) {
      return;
    }

    let cancelled = false;
    lastDailyTopAttemptHashRef.current = nextHash;
    lastDailyTopAttemptAtRef.current = Date.now();
    const timeoutId = window.setTimeout(async () => {
      try {
        await syncDailyTopSnapshot(dailyTop5, DAILY_TOP_TZ);
        if (!cancelled) {
          lastDailyTopHashRef.current = nextHash;
        }
      } catch (error) {
        console.warn('No se pudo sincronizar el top 5 diario:', error);
      }
    }, DAILY_TOP_SYNC_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [dailyTop5]);

  // --- Handlers: Medicines ---
  const handleAddMedicine = async (med: Medicine) => {
      setMedicines(prev => [...prev, med]);
      await db.putItem('medicines', med);
  };

  const handleUpdateMedicine = async (updatedMed: Medicine) => {
      setMedicines(prev => prev.map(m => m.id === updatedMed.id ? updatedMed : m));
      await db.putItem('medicines', updatedMed);
  };

  const handleDeleteMedicine = async (id: string) => {
      setMedicines(prev => prev.filter(m => m.id !== id));
      await db.deleteItem('medicines', id);
  }

  // --- Handlers: Expenses ---
  const handleAddExpense = async (exp: Expense) => {
      setExpenses(prev => [...prev, exp]);
      await db.putItem('expenses', exp);
  };
  
  const handleUpdateExpense = async (updatedExp: Expense) => {
      setExpenses(prev => prev.map(e => e.id === updatedExp.id ? updatedExp : e));
      await db.putItem('expenses', updatedExp);
  };

  const handleDeleteExpense = async (id: string) => {
      setExpenses(prev => prev.filter(e => e.id !== id));
      await db.deleteItem('expenses', id);
  };

  // --- Handlers: Notes ---
  const handleAddNote = useCallback(async (note: NoteDoc) => {
      setNotes(prev => [note, ...prev]);
      await db.putItem('notes', note);
  }, []);

  const handleUpdateNote = async (updatedNote: NoteDoc) => {
      setNotes(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));
      await db.putItem('notes', updatedNote);
  };

  const handleDeleteNote = async (id: string) => {
      const noteToDelete = notes.find((n) => n.id === id);
      setNotes(prev => prev.filter(n => n.id !== id));
      await db.deleteItem('notes', id);
      const attachmentIds = (noteToDelete?.attachments || []).map((attachment) => attachment.id);
      for (const attachmentId of attachmentIds) {
        try {
          await db.deleteAttachmentBlob(attachmentId);
        } catch (error) {
          console.error('No se pudo borrar adjunto de nota', error);
        }
      }
  };

  const handleAddNoteFolder = async (folder: NoteFolder) => {
      setNoteFolders(prev => [...prev, folder]);
      await db.putItem('note_folders', folder);
  };

  const handleUpdateNoteFolder = async (updatedFolder: NoteFolder) => {
      setNoteFolders(prev => prev.map(f => f.id === updatedFolder.id ? updatedFolder : f));
      await db.putItem('note_folders', updatedFolder);
  };

  const handleDeleteNoteFolder = async (id: string) => {
      setNoteFolders(prev => prev.filter(f => f.id !== id));
      await db.deleteItem('note_folders', id);
      const affectedNotes = notes.filter(n => n.folderId === id);
      if (affectedNotes.length > 0) {
        const timestamp = Date.now();
        const updatedNotes = affectedNotes.map(n => ({ ...n, folderId: null, updatedAt: timestamp }));
        setNotes(prev => prev.map(n => n.folderId === id ? { ...n, folderId: null, updatedAt: timestamp } : n));
        for (const note of updatedNotes) {
          await db.putItem('notes', note);
        }
      }
  };

  const stripFileExtension = (name: string) => {
    const dotIndex = name.lastIndexOf('.');
    if (dotIndex <= 0) return name;
    return name.slice(0, dotIndex);
  };

  const saveAttachmentBlobs = async (files: File[]) => {
    const saved: AttachmentMeta[] = [];
    try {
      for (const file of files) {
        const attachmentId = crypto.randomUUID();
        const cleanName = sanitizeAttachmentName(file.name);
        await db.putAttachmentBlob(attachmentId, file);
        saved.push({
          id: attachmentId,
          name: cleanName,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          createdAt: Date.now(),
        });
      }
      return saved;
    } catch (error) {
      for (const attachment of saved) {
        try {
          await db.deleteAttachmentBlob(attachment.id);
        } catch (cleanupError) {
          console.error('Error limpiando adjunto tras fallo', cleanupError);
        }
      }
      throw error;
    }
  };

  const attachFilesToTodo = useCallback(async (todoId: string, files: File[]) => {
    const todo = todos.find((item) => item.id === todoId);
    if (!todo) {
      throw new Error('La tarea seleccionada no existe.');
    }

    const currentAttachments = todo.attachments || [];
    const dedupedFiles = files.filter((file) => {
      const cleanName = sanitizeAttachmentName(file.name);
      return !currentAttachments.some((a) => a.name === cleanName && a.size === file.size);
    });

    if (dedupedFiles.length === 0) {
      throw new Error('Todos los archivos ya estaban adjuntos en esta tarea.');
    }
    if (currentAttachments.length + dedupedFiles.length > MAX_ATTACHMENTS_PER_ENTITY) {
      throw new Error(`Maximo ${MAX_ATTACHMENTS_PER_ENTITY} adjuntos por tarea.`);
    }

    const newAttachments = await saveAttachmentBlobs(dedupedFiles);
    const updatedTodo: Todo = {
      ...todo,
      attachments: [...currentAttachments, ...newAttachments],
    };
    await db.putItem('todos', updatedTodo);
    setTodos((prev) => prev.map((item) => (item.id === updatedTodo.id ? updatedTodo : item)));
    return newAttachments.length;
  }, [todos]);

  const attachFilesToNote = useCallback(async (noteId: string, files: File[]) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note) {
      throw new Error('La nota seleccionada no existe.');
    }
    if (note.locked) {
      throw new Error('No se puede adjuntar en una nota bloqueada.');
    }

    const currentAttachments = note.attachments || [];
    const dedupedFiles = files.filter((file) => {
      const cleanName = sanitizeAttachmentName(file.name);
      return !currentAttachments.some((a) => a.name === cleanName && a.size === file.size);
    });

    if (dedupedFiles.length === 0) {
      throw new Error('Todos los archivos ya estaban adjuntos en esta nota.');
    }
    if (currentAttachments.length + dedupedFiles.length > MAX_ATTACHMENTS_PER_ENTITY) {
      throw new Error(`Maximo ${MAX_ATTACHMENTS_PER_ENTITY} adjuntos por nota.`);
    }

    const newAttachments = await saveAttachmentBlobs(dedupedFiles);
    const updatedNote: NoteDoc = {
      ...note,
      attachments: [...currentAttachments, ...newAttachments],
      updatedAt: Date.now(),
    };
    await db.putItem('notes', updatedNote);
    setNotes((prev) => prev.map((item) => (item.id === updatedNote.id ? updatedNote : item)));
    return newAttachments.length;
  }, [notes]);

  const openAttachment = useCallback(async (attachment: AttachmentMeta) => {
    try {
      const blob = await db.getAttachmentBlob(attachment.id);
      if (!blob) {
        setNotification({ message: 'Adjunto no encontrado en almacenamiento local.', type: 'error' });
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        setNotification({ message: 'El navegador bloqueo la nueva pestana.', type: 'error' });
      }
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (error) {
      console.error('Error abriendo adjunto', error);
      setNotification({ message: 'No se pudo abrir el adjunto.', type: 'error' });
    }
  }, []);

  const removeTodoAttachment = useCallback(async (todoId: string, attachmentId: string) => {
    const todo = todos.find((item) => item.id === todoId);
    if (!todo) return;
    const nextAttachments = (todo.attachments || []).filter((attachment) => attachment.id !== attachmentId);
    const updatedTodo: Todo = {
      ...todo,
      attachments: nextAttachments.length ? nextAttachments : undefined,
    };
    await db.putItem('todos', updatedTodo);
    setTodos((prev) => prev.map((item) => (item.id === updatedTodo.id ? updatedTodo : item)));
    try {
      await db.deleteAttachmentBlob(attachmentId);
    } catch (error) {
      console.error('No se pudo borrar blob adjunto de tarea', error);
    }
  }, [todos]);

  const removeNoteAttachment = useCallback(async (noteId: string, attachmentId: string) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    const nextAttachments = (note.attachments || []).filter((attachment) => attachment.id !== attachmentId);
    const updatedNote: NoteDoc = {
      ...note,
      attachments: nextAttachments.length ? nextAttachments : undefined,
      updatedAt: Date.now(),
    };
    await db.putItem('notes', updatedNote);
    setNotes((prev) => prev.map((item) => (item.id === updatedNote.id ? updatedNote : item)));
    try {
      await db.deleteAttachmentBlob(attachmentId);
    } catch (error) {
      console.error('No se pudo borrar blob adjunto de nota', error);
    }
  }, [notes]);

  const resolveDropTargetFromElement = useCallback((element: Element | null): DropTarget | null => {
    if (!element) return null;
    const zone = element.closest('[data-drop-scope]');
    if (!zone) return null;
    const scope = zone.getAttribute('data-drop-scope');
    const dropId = zone.getAttribute('data-drop-id');
    if (scope === 'todo' && dropId) {
      return { type: 'todo', id: dropId };
    }
    if (scope === 'note' && dropId) {
      return { type: 'note', id: dropId };
    }
    if (scope === 'new_todo_input') {
      return { type: 'new_todo_input' };
    }
    return null;
  }, []);

  const resolveDefaultDropTarget = useCallback((): DropTarget | null => {
    if (viewMode === ViewMode.LIST) {
      return { type: 'new_todo_input' };
    }
    if (viewMode === ViewMode.NOTES) {
      const firstUnlockedNote = notes.find((note) => !note.locked);
      if (firstUnlockedNote) {
        return { type: 'note', id: firstUnlockedNote.id };
      }
    }
    if (todos.length > 0) {
      return { type: 'todo', id: todos[0].id };
    }
    const firstUnlockedNote = notes.find((note) => !note.locked);
    if (firstUnlockedNote) {
      return { type: 'note', id: firstUnlockedNote.id };
    }
    return { type: 'new_todo_input' };
  }, [notes, todos, viewMode]);

  const describeDropTarget = useCallback((target: DropTarget | null) => {
    if (!target) return 'destino no detectado';
    if (target.type === 'new_todo_input') return 'nueva tarea';
    if (target.type === 'todo') {
      const todo = todos.find((item) => item.id === target.id);
      return todo ? `tarea: ${todo.text}` : 'tarea';
    }
    const note = notes.find((item) => item.id === target.id);
    return note ? `nota: ${note.title || 'Untitled'}` : 'nota';
  }, [notes, todos]);

  const collectValidDropFiles = useCallback((files: File[]) => {
    const validFiles: File[] = [];
    const errors: string[] = [];
    const dedupInDrop = new Set<string>();

    for (const file of files) {
      const dropKey = `${file.name.toLowerCase()}::${file.size}::${file.lastModified}`;
      if (dedupInDrop.has(dropKey)) {
        errors.push(`Duplicado omitido: ${file.name}`);
        continue;
      }
      dedupInDrop.add(dropKey);

      const validation = validateAttachmentFile(file);
      if (!validation.valid) {
        errors.push(validation.reason);
        continue;
      }

      if (validFiles.length >= MAX_ATTACHMENTS_PER_ENTITY) {
        errors.push(`Solo se permiten ${MAX_ATTACHMENTS_PER_ENTITY} archivos por carga.`);
        break;
      }
      validFiles.push(file);
    }

    return { validFiles, errors };
  }, []);

  const handleAutomaticAttachmentDrop = useCallback(async (files: File[], resolvedTarget: DropTarget | null) => {
    if (dropProcessing) return;
    const { validFiles, errors } = collectValidDropFiles(files);
    if (validFiles.length === 0) {
      setNotification({ message: errors[0] || 'No se detectaron archivos validos.', type: 'error' });
      return;
    }

    const target = resolvedTarget || lastAttachmentTargetRef.current || resolveDefaultDropTarget();
    if (!target) {
      setNotification({ message: 'No fue posible detectar destino del adjunto.', type: 'error' });
      return;
    }

    setDropProcessing(true);
    try {
      const skippedSuffix = errors.length > 0 ? ` (${errors.length} omitido(s))` : '';
      if (target.type === 'todo') {
        const count = await attachFilesToTodo(target.id, validFiles);
        setNotification({
          message: `${count} adjunto(s) guardado(s) en ${describeDropTarget(target)}${skippedSuffix}`,
          type: 'success',
        });
      } else if (target.type === 'note') {
        const count = await attachFilesToNote(target.id, validFiles);
        setNotification({
          message: `${count} adjunto(s) guardado(s) en ${describeDropTarget(target)}${skippedSuffix}`,
          type: 'success',
        });
      } else {
        const preparedAttachments = await saveAttachmentBlobs(validFiles);
        const defaultText = stripFileExtension(sanitizeAttachmentName(validFiles[0].name));
        const todoText = inputValue.trim() || defaultText || 'Nueva tarea';
        await addTodo(todoText, inputPriority, undefined, undefined, preparedAttachments);
        setNotification({
          message: `${preparedAttachments.length} adjunto(s) en nueva tarea${skippedSuffix}`,
          type: 'success',
        });
      }
      if (errors.length > 0) {
        console.warn('Archivos omitidos en drop:', errors);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron adjuntar los archivos.';
      setNotification({ message, type: 'error' });
    } finally {
      setDropProcessing(false);
    }
  }, [
    addTodo,
    attachFilesToNote,
    attachFilesToTodo,
    collectValidDropFiles,
    describeDropTarget,
    dropProcessing,
    inputPriority,
    inputValue,
    resolveDefaultDropTarget,
  ]);

  useEffect(() => {
    const rememberTarget = (event: Event) => {
      const targetElement = event.target as Element | null;
      const resolved = resolveDropTargetFromElement(targetElement);
      if (resolved) {
        lastAttachmentTargetRef.current = resolved;
      }
    };
    document.addEventListener('focusin', rememberTarget, true);
    document.addEventListener('pointerdown', rememberTarget, true);
    return () => {
      document.removeEventListener('focusin', rememberTarget, true);
      document.removeEventListener('pointerdown', rememberTarget, true);
    };
  }, [resolveDropTargetFromElement]);

  useEffect(() => {
    const hasFilePayload = (event: DragEvent) => {
      if (!event.dataTransfer) return false;
      return Array.from(event.dataTransfer.types).includes('Files');
    };

    const inferTargetAtPointer = (event: DragEvent) => {
      const pointerElement = document.elementFromPoint(event.clientX, event.clientY);
      return (
        resolveDropTargetFromElement(pointerElement) ||
        lastAttachmentTargetRef.current ||
        resolveDefaultDropTarget()
      );
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setIsDragOverlayVisible(true);
      setDragTargetPreview(inferTargetAtPointer(event));
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setDragTargetPreview(inferTargetAtPointer(event));
    };

    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragOverlayVisible(false);
        setDragTargetPreview(null);
      }
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragOverlayVisible(false);
      const files = Array.from(event.dataTransfer?.files || []);
      const target = inferTargetAtPointer(event);
      setDragTargetPreview(null);
      if (files.length === 0) return;
      void handleAutomaticAttachmentDrop(files, target);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleAutomaticAttachmentDrop, resolveDefaultDropTarget, resolveDropTargetFromElement]);

  const createQuickNote = useCallback(async () => {
    if (quickNoteInFlightRef.current) return;
    quickNoteInFlightRef.current = true;
    try {
      const now = Date.now();
      const quickNote: NoteDoc = {
        id: crypto.randomUUID(),
        title: 'Untitled',
        content: '',
        folderId: null,
        tags: [],
        createdAt: now,
        updatedAt: now,
        locked: false,
      };
      await handleAddNote(quickNote);
      setViewMode(ViewMode.NOTES);
      setOpenNoteId(quickNote.id);
    } finally {
      quickNoteInFlightRef.current = false;
    }
  }, [handleAddNote]);

    // --- Handler: Reminder (panel actions) ---
  const handleSendReminder = async () => {
      const textToSend = (reminderText || inputValue).trim();
      if (!textToSend) {
          setNotification({ message: 'Please enter text for the reminder', type: 'error' });
          return;
      }

      const hasAnyAction = Object.values(reminderOptions).some(Boolean);
      if (!hasAnyAction) {
          setNotification({ message: 'Selecciona al menos una accion', type: 'error' });
          return;
      }

      const needsApi =
        reminderOptions.sendToApi ||
        reminderOptions.createTaskFromResponse;

      let res = null as any;

      if (needsApi) {
        setReminderLoading(true);
        res = await sendReminder(textToSend, { priority: inputPriority, type: 'TODO' });
        setReminderLoading(false);

        if (!res?.success) {
          setNotification({ message: res?.message || 'Failed to send', type: 'error' });
          return;
        }

        setNotification({ message: 'Recibido', type: 'success' });
      }

      if (reminderOptions.openWhatsApp) {
        let link =
          res?.whatsappLink ||
          res?.data?.whatsapp_link ||
          res?.data?.whatsappLink;
        if (!link) {
          link = `https://wa.me/?text=${encodeURIComponent(textToSend)}`;
        }
        const opened = tryOpenWhatsAppLink(link);
        if (link && !opened) {
          setNotification({ message: 'No se pudo abrir WhatsApp', type: 'error' });
        }
      }

      if (reminderOptions.createTaskFromResponse) {
        const responseText =
          res?.reminderText ||
          res?.data?.reminder_text ||
          textToSend;
        const subtasks = parseSubtasksFromText(responseText);
        const finalSubtasks = subtasks.length > 0
          ? subtasks
          : responseText
            ? [{
                id: crypto.randomUUID(),
                text: responseText,
                completed: false
              }]
            : [];

        const newTodo: Todo = {
          id: crypto.randomUUID(),
          text: textToSend,
          completed: false,
          createdAt: Date.now(),
          priority: inputPriority,
          complexity: Math.max(1, Math.min(10, Math.ceil(finalSubtasks.length / 2))),
          subtasks: finalSubtasks,
          description: responseText,
          dueDate: undefined
        };
        setTodos(prev => [newTodo, ...prev]);
        await db.putItem('todos', newTodo);
      }

      if (reminderOptions.localNotification) {
        const now = Date.now();
        let scheduledAt = now + MS_MINUTE;
        if (localReminderMode === 'hours') {
          const hours = Math.max(1, Math.round(localReminderHours || 1));
          scheduledAt = now + hours * MS_HOUR;
        } else if (localReminderMode === 'days') {
          const days = Math.max(1, Math.round(localReminderDays || 1));
          scheduledAt = now + days * MS_DAY;
        }
        await createLocalNotification(textToSend, scheduledAt);
      }

      setReminderText('');
      setReminderEdited(false);
      setIsReminderPanelOpen(false);
  };

  const handleSendDailyTopNow = async () => {
    try {
      setDailyTopSendLoading(true);
      const res = await sendDailyTopNow();
      if (res.status === 'already_sent') {
        setNotification({ message: 'Top 5 ya enviado hoy', type: 'success' });
        return;
      }
      if (res.status === 'no_snapshot') {
        setNotification({ message: 'Aun no hay snapshot top 5 para enviar', type: 'error' });
        return;
      }
      if (res.status === 'empty_top5') {
        setNotification({ message: 'No hay tareas top 5 para enviar hoy', type: 'error' });
        return;
      }
      setNotification({ message: 'Top 5 enviado a Telegram', type: 'success' });
    } catch (error: any) {
      setNotification({ message: error?.message || 'Error enviando top 5', type: 'error' });
    } finally {
      setDailyTopSendLoading(false);
    }
  };


  // --- Voice Agent & AI Helpers ---

  // Fuzzy match delete for voice commands
  const deleteTodoByText = useCallback(async (text: string) => {
    const lowerText = text.toLowerCase();
    const match = todos.find(t => t.text.toLowerCase().includes(lowerText));
    
    if (match) {
        setTodos(prev => prev.filter(t => t.id !== match.id));
        await db.softDeleteTodo(match);
    }
  }, [todos]);

  // Fuzzy match mark for voice commands
  const markTodoByText = useCallback(async (text: string, completed: boolean) => {
      const lowerText = text.toLowerCase();
      const match = todos.find(t => t.text.toLowerCase().includes(lowerText));
      if (match) {
          const updated = { ...match, completed };
          setTodos(prev => prev.map(t => t.id === match.id ? updated : t));
          await db.putItem('todos', updated);
      }
  }, [todos]);

  const handleBrainstorm = async () => {
    if (!brainstormQuery.trim()) return;
    setBrainstormLoading(true);
    setBrainstormSources([]);
    
    const result = await brainstormTasks(brainstormQuery);
    
    // Persist Brainstorm result to "History" in DB
    await db.saveAIResult(brainstormQuery, result.text);

    // Parse the list output from Gemini into Subtasks
    const newSubtasks = parseSubtasksFromText(result.text);

    // Create a single Todo item containing all generated steps
    if (newSubtasks.length > 0) {
        const newTodo: Todo = {
            id: crypto.randomUUID(),
            text: brainstormQuery, // The query becomes the Title
            completed: false,
            createdAt: Date.now(),
            priority: 'P2', // Default priority for AI plans
            complexity: Math.min(10, Math.ceil(newSubtasks.length / 2)),
            subtasks: newSubtasks,
            description: "AI Generated Plan"
        };
        
        setTodos(prev => [newTodo, ...prev]);
        await db.putItem('todos', newTodo);
        
        // Switch back to list view to see the new "box"
        setViewMode(ViewMode.LIST);
    }

    setBrainstormSources(result.sources);
    setBrainstormLoading(false);
    setBrainstormQuery('');
  };

  // --- Quick navigation shortcuts (used from Calendar modal) ---
  const openReminderFromCalendar = useCallback(() => {
    setViewMode(ViewMode.LIST);
    openReminderPanel();
    setIsInputExpanded(true);
  }, [openReminderPanel]);

  const openMedicinesFromCalendar = useCallback(() => {
    setViewMode(ViewMode.MEDICINES);
  }, []);

  const openExpensesFromCalendar = useCallback(() => {
    setViewMode(ViewMode.EXPENSES);
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const isQuickNoteShortcut = event.ctrlKey && event.altKey && event.code === 'KeyN';
      if (!isQuickNoteShortcut) return;
      event.preventDefault();
      void createQuickNote();
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [createQuickNote]);

  // --- Render Content Area ---
  const renderContent = () => {
    const dragTargetTodoId = isDragOverlayVisible && dragTargetPreview?.type === 'todo'
      ? dragTargetPreview.id
      : null;
    const dragTargetNoteId = isDragOverlayVisible && dragTargetPreview?.type === 'note'
      ? dragTargetPreview.id
      : null;
    const isNewTodoDropTarget = isDragOverlayVisible && dragTargetPreview?.type === 'new_todo_input';

    if (viewMode === ViewMode.MEDICINES) {
        return (
            <MedicinePanel 
                embedded
                medicines={medicines}
                setMedicines={setMedicines}
                onAdd={handleAddMedicine}
                onUpdate={handleUpdateMedicine}
                onDelete={handleDeleteMedicine}
                setNotification={setNotification}
            />
        );
    }

    if (viewMode === ViewMode.EXPENSES) {
        return (
            <ExpensesPanel
                expenses={expenses}
                onAdd={handleAddExpense}
                onUpdate={handleUpdateExpense}
                onDelete={handleDeleteExpense}
            />
        );
    }

    if (viewMode === ViewMode.CALENDAR) {
      return (
            <CalendarPanel 
                todos={todos}
                medicines={medicines}
                onUpdateTodo={handleUpdateTodo}
                onAddTodo={(text, priority, date) => addTodo(text, priority, date)}
                onOpenReminder={openReminderFromCalendar}
                onOpenMedicines={openMedicinesFromCalendar}
                onOpenExpenses={openExpensesFromCalendar}
            />
        );
    }

    if (viewMode === ViewMode.NOTES) {
        return (
            <NotesPanel
                notes={notes}
                folders={noteFolders}
                onAddNote={handleAddNote}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onAddFolder={handleAddNoteFolder}
                onUpdateFolder={handleUpdateNoteFolder}
                onDeleteFolder={handleDeleteNoteFolder}
                openNoteId={openNoteId}
                onConsumeOpenNoteId={consumeOpenNoteId}
                todos={todos}
                onUpdateTodo={handleUpdateTodo}
                onOpenAttachment={openAttachment}
                onDeleteNoteAttachment={removeNoteAttachment}
                activeDropNoteId={dragTargetNoteId}
            />
        );
    }

    // Filtered Todos
    const filteredTodos = filterPriority === 'ALL' 
        ? todos 
        : todos.filter(t => (t.priority || 'P4') === filterPriority);

    const priorityOrder: Record<Priority, number> = {
        P1: 1,
        P2: 2,
        P3: 3,
        P4: 4,
    };

    const sortedTodos = [...filteredTodos].sort((a, b) => {
        const aPriority = priorityOrder[a.priority || 'P4'];
        const bPriority = priorityOrder[b.priority || 'P4'];
        if (aPriority !== bPriority) return aPriority - bPriority;

        const aComplexity = a.complexity || 1;
        const bComplexity = b.complexity || 1;
        if (aComplexity !== bComplexity) return aComplexity - bComplexity;

        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return (
        <div className="max-w-3xl mx-auto">
            {/* Input Section */}
            <div className="mb-8">
              {viewMode === ViewMode.LIST ? (
                 <>
                  <div
                    data-drop-scope="new_todo_input"
                    className={`relative transition-all duration-300 ease-in-out ${
                      isInputExpanded ? 'h-48' : 'h-24 sm:h-20'
                    } ${isNewTodoDropTarget ? 'ring-2 ring-indigo-400/80 rounded-xl' : ''}`}
                  >
                   <textarea 
                     value={inputValue}
                     onChange={(e) => setInputValue(e.target.value)}
                     onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.shiftKey) {
                             e.preventDefault();
                             addTodo(inputValue, inputPriority);
                         }
                     }}
                     placeholder="Dictate or type a new task..."
                     className={`
                        w-full h-full bg-slate-900 border border-slate-800 rounded-xl py-4 pl-5 pr-36 
                        focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 
                        transition-all placeholder:text-slate-600 resize-none text-base leading-relaxed
                     `}
                   />
                   
                   {/* Controls Group */}
                   <div className="absolute right-3 bottom-3 flex items-center gap-2 bg-slate-900/80 backdrop-blur-sm p-1 rounded-lg z-20">
                     
                     {/* Microphone Dictation */}
                     <VoiceDictation
                        onTranscript={(text) => {
                            setInputValue((prev) => (prev ? `${prev} ${text}` : text));
                            setIsInputExpanded(true);
                        }}
                     />

                     {/* Reminder Button (Toggles extra input) */}
                     <button
                        onClick={() => (isReminderPanelOpen ? closeReminderPanel() : openReminderPanel())}
                        className={`p-2 rounded-lg transition-colors ${isReminderPanelOpen ? 'text-indigo-400 bg-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                        title="Open Reminder Panel"
                     >
                         <BellIcon className="w-5 h-5" />
                     </button>

                     {/* Priority Selector */}
                     <div className="flex items-center gap-1 mr-2 bg-slate-800 rounded p-1">
                        {(['P1', 'P2', 'P3', 'P4'] as Priority[]).map(p => (
                            <button
                                key={p}
                                onClick={() => setInputPriority(p)}
                                className={`
                                    w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors
                                    ${inputPriority === p 
                                        ? (p === 'P1' ? 'bg-red-500/20 text-red-500' : p === 'P2' ? 'bg-orange-500/20 text-orange-500' : p === 'P3' ? 'bg-blue-500/20 text-blue-500' : 'bg-slate-600/20 text-slate-400')
                                        : 'text-slate-600 hover:text-slate-400'
                                    }
                                    ${inputPriority === p ? 'ring-1 ring-inset ring-white/10' : ''}
                                `}
                                title={`Priority ${p}`}
                            >
                                {p === 'P4' ? '-' : p.replace('P','')}
                            </button>
                        ))}
                     </div>

                     {/* Date Picker Input for Main Create */}
                     <div className="flex items-center mr-2 bg-slate-800 rounded p-1">
                        <input 
                            type="date"
                            value={inputDueDate}
                            onChange={(e) => setInputDueDate(e.target.value)}
                            className="bg-transparent text-xs text-slate-400 hover:text-white focus:outline-none w-5 h-6 opacity-50 hover:opacity-100 focus:w-24 transition-all"
                            title="Set Due Date"
                        />
                        <ClockIcon className="w-4 h-4 text-slate-400 pointer-events-none absolute ml-0.5" />
                     </div>
                     
                     {/* Expand Button */}
                     <button
                        onClick={() => setIsInputExpanded(!isInputExpanded)}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                        title={isInputExpanded ? "Collapse" : "Expand"}
                     >
                        {isInputExpanded ? <ArrowsCollapseIcon className="w-5 h-5" /> : <ArrowsExpandIcon className="w-5 h-5" />}
                     </button>

                     {/* Add Button */}
                     <button 
                       onClick={() => addTodo(inputValue, inputPriority)}
                       className="p-2 bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors text-white shadow-lg"
                     >
                       <PlusIcon className="w-5 h-5" />
                     </button>

                     {/* Note Link Button */}
                     <button
                       onClick={() => setIsNoteLinkerOpen(!isNoteLinkerOpen)}
                       className={`p-2 rounded-lg transition-colors ${isNoteLinkerOpen ? 'text-indigo-400 bg-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                       title="Vincular nota"
                     >
                       <DocumentIcon className="w-5 h-5" />
                     </button>
                   </div>

                   {/* Note Linker Panel */}
                    {isNoteLinkerOpen && (
                      <div className="absolute right-3 bottom-16 w-80 bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl z-30">
                       <div className="flex items-center justify-between mb-2">
                         <h4 className="text-sm font-medium text-slate-200">Vincular nota a tarea</h4>
                         <button
                           onClick={() => setIsNoteLinkerOpen(false)}
                           className="text-slate-400 hover:text-slate-200"
                         >
                           <XMarkIcon className="w-4 h-4" />
                         </button>
                       </div>
                       
                       <input
                         type="text"
                         value={noteLinkQuery}
                         onChange={(e) => setNoteLinkQuery(e.target.value)}
                         placeholder="Buscar nota..."
                         className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 mb-2"
                       />
                       
                       <div className="max-h-40 overflow-y-auto space-y-1">
                         {notes
                           .filter(note => 
                             note.title.toLowerCase().includes(noteLinkQuery.toLowerCase())
                           )
                           .slice(0, 6)
                           .map(note => (
                             <button
                               key={note.id}
                               onClick={() => {
                                 addTodo(inputValue, inputPriority, undefined, note.id);
                               }}
                               className="w-full text-left text-xs px-2 py-1 rounded flex items-center gap-2 text-slate-300 hover:bg-slate-700"
                             >
                               <DocumentIcon className="w-3 h-3 text-indigo-400" />
                               <span className="truncate flex-1">{note.title}</span>
                               <span className="text-slate-500">
                                 {noteFolders.find(f => f.id === note.folderId)?.name || 'Sin carpeta'}
                               </span>
                             </button>
                           ))}
                         {notes.length === 0 && (
                           <p className="text-xs text-slate-500 text-center py-2">
                             No hay notas disponibles
                           </p>
                         )}
                        </div>
                      </div>
                    )}

                  </div>
                   <p className="mt-2 text-[11px] text-slate-500">
                     Arrastra PDF, TXT, DOC o DOCX desde Descargas o tu carpeta de archivos para adjuntar.
                   </p>
                 </>
              ) : (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="block text-sm font-medium text-slate-400 mb-2">What do you want to achieve?</label>
                  <div className="flex gap-3">
                    <input 
                      type="text"
                      value={brainstormQuery}
                      onChange={(e) => setBrainstormQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleBrainstorm()}
                      placeholder="e.g., Plan a birthday party for a 5-year-old"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 focus:outline-none focus:border-primary-500/50"
                    />
                    <button 
                      onClick={handleBrainstorm}
                      disabled={brainstormLoading}
                      className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                      {brainstormLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <BrainIcon className="w-5 h-5" />}
                      Generate
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
                    <BrainIcon className="w-3 h-3" /> 
                    Uses Gemini 2.5 Thinking Mode & Google Search Grounding
                  </p>
                </div>
              )}
            </div>

            {/* Grounding Sources Display */}
            {brainstormSources.length > 0 && (
              <div className="mb-6 p-4 bg-slate-900/30 border border-slate-800/50 rounded-lg animate-in fade-in">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sources Used</h3>
                <div className="flex flex-wrap gap-2">
                  {brainstormSources.map((s, i) => (
                    <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-400 hover:text-primary-300 hover:underline truncate max-w-xs bg-slate-900/50 px-2 py-1 rounded border border-slate-800">
                      {s.title || s.uri}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* List */}
            {viewMode === ViewMode.LIST && (
                <div className="space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20">
                  {filteredTodos.length === 0 && (
                     <div className="text-center py-12 text-slate-600">
                       <p>{todos.length === 0 ? "No tasks yet." : "No tasks found with this filter."}</p>
                     </div>
                  )}
                  {sortedTodos.map(todo => (
                    <TodoItem 
                      key={todo.id} 
                      todo={todo} 
                      onUpdate={handleUpdateTodo}
                      onDelete={deleteTodo} 
                      notes={notes}
                      noteFolders={noteFolders}
                      onOpenNote={handleOpenNote}
                      onOpenAttachment={openAttachment}
                      onDeleteAttachment={removeTodoAttachment}
                      isDropTarget={dragTargetTodoId === todo.id}
                    />
                  ))}
                </div>
            )}
        </div>
    );
  };

  const todayStartTs = getDayStartTs(nowTs);
  const getDayOffset = (timestamp: number) => {
    return Math.round((getDayStartTs(timestamp) - todayStartTs) / MS_DAY);
  };

  const formatSchedule = (timestamp: number) =>
    new Date(timestamp).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

  const filteredNotifications = useMemo(() => {
    return notifications
      .filter(item => {
        const offset = getDayOffset(item.scheduledAt);
        if (notificationFilter === 'today') {
          return offset === 0 && item.scheduledAt <= nowTs;
        }
        if (notificationFilter === 'tomorrow') {
          return offset === 1;
        }
        return offset >= 0 && offset <= 6;
      })
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }, [notifications, notificationFilter, nowTs]);

  const weeklyUnreadCount = useMemo(() => {
    return notifications.filter(item => {
      const offset = getDayOffset(item.scheduledAt);
      return offset >= 0 && offset <= 6 && !item.read;
    }).length;
  }, [notifications, nowTs]);

  useEffect(() => {
    if (!notificationsReady) return;
    const todayStart = getDayStartTs(nowTs);
    const toDelete = notifications.filter(item => item.read && getDayStartTs(item.scheduledAt) < todayStart);
    if (toDelete.length === 0) return;
    const toDeleteIds = new Set(toDelete.map(item => item.id));
    setNotifications(prev => prev.filter(item => !toDeleteIds.has(item.id)));
    toDelete.forEach(item => {
      db.deleteItem('notifications', item.id);
    });
  }, [notifications, nowTs, notificationsReady]);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans selection:bg-primary-500/30 overflow-hidden relative">
      {/* Toast Notification Layer */}
      {notification && (
        <Toast 
            message={notification.message} 
            type={notification.type} 
            sticky={notification.sticky}
            onClose={() => setNotification(null)} 
        />
      )}

      {/* Notification Center (top-right) */}
      <div className="fixed top-4 right-4 z-[70]">
        <button
          onClick={toggleNotificationCenter}
          className="relative p-2 rounded-full bg-slate-900/80 border border-slate-800 hover:bg-slate-800 transition-colors"
          title="Notifications"
        >
          <BellIcon className="w-5 h-5 text-slate-200" />
          {weeklyUnreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {weeklyUnreadCount}
            </span>
          )}
        </button>

        {notificationCenterOpen && (
          <div className="mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-slate-400">Notificaciones</p>
              <button
                onClick={() => setNotificationCenterOpen(false)}
                className="text-slate-500 hover:text-white text-xs"
              >
                Cerrar
              </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              {([
                { id: 'today', label: 'Hoy' },
                { id: 'tomorrow', label: 'Manana' },
                { id: 'week', label: '7 dias' },
              ] as Array<{ id: NotificationFilter; label: string }>).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setNotificationFilter(tab.id)}
                  className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                    notificationFilter === tab.id
                      ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                      : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {filteredNotifications.length === 0 && (
              <p className="text-sm text-slate-500">Sin notificaciones para esta vista.</p>
            )}

            {filteredNotifications.map(item => (
              <div
                key={item.id}
                className={`border border-slate-800 rounded-lg p-2 mb-2 last:mb-0 bg-slate-950/40 ${
                  item.read ? 'opacity-60' : ''
                }`}
              >
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.read}
                    onChange={() => toggleNotificationRead(item)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 break-words">{item.message}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                      <span className="uppercase tracking-wide">{getNotificationSourceLabel(item.source)}</span>
                      <span>{formatSchedule(item.scheduledAt)}</span>
                    </div>
                  </div>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar Navigation */}
      <Sidebar 
        currentView={viewMode} 
        setViewMode={setViewMode} 
        currentPriorityFilter={filterPriority}
        setPriorityFilter={setFilterPriority}
        noteFolders={noteFolders}
        notes={notes}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 pt-12 scroll-smooth">
           {/* Page Title (dynamic based on view) */}
           {viewMode === ViewMode.LIST && (
               <div className="max-w-3xl mx-auto mb-8">
                   <h2 className="text-3xl font-bold text-white mb-1 bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent inline-block">
                       todo app
                   </h2>
                   <p className="text-slate-400 text-sm">
                       {filterPriority === 'ALL' ? 'lista de tareas con calendario y programacion' : `Showing ${filterPriority} Priority Tasks`}
                   </p>
               </div>
           )}

           {viewMode === ViewMode.BRAINSTORM && (
                <div className="max-w-3xl mx-auto mb-8">
                    <h2 className="text-3xl font-bold text-white mb-1 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent inline-block">
                        AI Planner
                    </h2>
                    <p className="text-slate-400 text-sm">Let Gemini help you plan your next project.</p>
                </div>
           )}

           {renderContent()}
      </main>

      {isDragOverlayVisible && (
        <div className="fixed inset-0 z-[80] pointer-events-none bg-indigo-500/10 border-2 border-dashed border-indigo-400/70 flex items-center justify-center">
          <div className="bg-slate-900/90 border border-indigo-400/50 rounded-xl px-5 py-3 text-sm text-indigo-100 shadow-xl">
            <p>Suelta para adjuntar archivos</p>
            <p className="text-xs text-indigo-200/80 mt-1">
              Destino automatico: {describeDropTarget(dragTargetPreview || lastAttachmentTargetRef.current || resolveDefaultDropTarget())}
            </p>
          </div>
        </div>
      )}

      {/* Reminder Actions Panel */}
      {isReminderPanelOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={closeReminderPanel}
        >
          <div
            className="w-[90vw] sm:w-[70vw] md:w-[50vw] lg:w-[40vw] bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">Reminder</p>
                <h3 className="text-xl font-bold text-white">Acciones del reminder</h3>
                <p className="text-xs text-slate-500 mt-1">Selecciona que quieres ejecutar.</p>
              </div>
              <button
                onClick={closeReminderPanel}
                className="text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg px-3 py-1"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">Mensaje</label>
              <textarea
                value={reminderText}
                onChange={(e) => {
                  setReminderText(e.target.value);
                  setReminderEdited(true);
                }}
                placeholder="Escribe el mensaje del reminder..."
                className="w-full min-h-[120px] bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-500 mt-2">Se sincroniza con el texto de la tarea si no editas aqui.</p>
            </div>

            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/40">
                <input
                  type="checkbox"
                  checked={reminderOptions.sendToApi}
                  onChange={(e) => updateReminderOption('sendToApi', e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm text-slate-200">Enviar a FastAPI</p>
                  <p className="text-xs text-slate-500">Hace POST al endpoint /reminder.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/40">
                <input
                  type="checkbox"
                  checked={reminderOptions.openWhatsApp}
                  onChange={(e) => updateReminderOption('openWhatsApp', e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm text-slate-200">Abrir WhatsApp</p>
                  <p className="text-xs text-slate-500">Abre una nueva pestana con el link de WhatsApp.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/40">
                <input
                  type="checkbox"
                  checked={reminderOptions.createTaskFromResponse}
                  onChange={(e) => updateReminderOption('createTaskFromResponse', e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm text-slate-200">Crear tarea con respuesta</p>
                  <p className="text-xs text-slate-500">Convierte la respuesta en subtareas automaticamente.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-800 bg-slate-950/40">
                <input
                  type="checkbox"
                  checked={reminderOptions.localNotification}
                  onChange={(e) => updateReminderOption('localNotification', e.target.checked)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm text-slate-200">Recordatorio app</p>
                  <p className="text-xs text-slate-500">Aparece en el centro de notificaciones de la web.</p>
                  {reminderOptions.localNotification && (
                    <div className="mt-3 space-y-2 text-xs text-slate-300">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="local-reminder-mode"
                          checked={localReminderMode === 'hours'}
                          onChange={() => setLocalReminderMode('hours')}
                        />
                        <span>Dentro de</span>
                        <input
                          type="number"
                          min={1}
                          max={168}
                          value={localReminderHours}
                          onChange={(e) => setLocalReminderHours(Number(e.target.value || 1))}
                          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        />
                        <span>horas</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="local-reminder-mode"
                          checked={localReminderMode === 'days'}
                          onChange={() => setLocalReminderMode('days')}
                        />
                        <span>Dentro de</span>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={localReminderDays}
                          onChange={(e) => setLocalReminderDays(Number(e.target.value || 1))}
                          className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        />
                        <span>dias</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="local-reminder-mode"
                          checked={localReminderMode === 'minute'}
                          onChange={() => setLocalReminderMode('minute')}
                        />
                        <span>En 1 minuto (test)</span>
                      </label>
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={handleSendDailyTopNow}
                disabled={dailyTopSendLoading}
                className="px-4 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {dailyTopSendLoading ? 'Enviando top 5...' : 'Enviar top 5 ahora (test)'}
              </button>
              <button
                onClick={closeReminderPanel}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendReminder}
                disabled={reminderLoading}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {reminderLoading ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
