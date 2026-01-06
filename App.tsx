
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Todo, ViewMode, Medicine, Expense, Priority, Subtask, NoteDoc, NoteFolder } from './types';
import { TodoItem } from './components/TodoItem';
import { brainstormTasks } from './services/geminiService';
import { PlusIcon, BrainIcon, ArrowsExpandIcon, ArrowsCollapseIcon, FlagIcon, BellIcon, ClockIcon, DocumentIcon, XMarkIcon } from './components/Icons';
import { MedicinePanel } from './components/MedicinePanel';
import { ExpensesPanel } from './components/ExpensesPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { NotesPanel } from './components/NotesPanel';
import { Sidebar } from './components/Sidebar';
import * as db from './services/db';
import { sendReminder, tryOpenWhatsAppLink } from './services/reminderService';
import { Toast } from './components/Toast';
import { VoiceDictation } from './components/VoiceDictation';

type LocalNotificationItem = {
  id: string;
  message: string;
  createdAt: number;
  read: boolean;
};

type ReminderOptions = {
  sendToApi: boolean;
  openWhatsApp: boolean;
  createTaskFromResponse: boolean;
  localNotification: boolean;
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
  const [brainstormQuery, setBrainstormQuery] = useState('');
  const [brainstormLoading, setBrainstormLoading] = useState(false);
  const [brainstormSources, setBrainstormSources] = useState<Array<{uri: string, title: string}>>([]);
  
  // State for note linking on task creation
  const [isNoteLinkerOpen, setIsNoteLinkerOpen] = useState(false);
  const [noteLinkQuery, setNoteLinkQuery] = useState('');

  // --- State: Reminder / Notification ---
  const [isReminderPanelOpen, setIsReminderPanelOpen] = useState(false);
  const [reminderText, setReminderText] = useState('');
  const [reminderEdited, setReminderEdited] = useState(false);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderDelayMinutes, setReminderDelayMinutes] = useState(5);
  const [reminderOptions, setReminderOptions] = useState<ReminderOptions>({
    sendToApi: true,
    openWhatsApp: false,
    createTaskFromResponse: false,
    localNotification: false,
  });
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error', sticky?: boolean } | null>(null);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [notificationInbox, setNotificationInbox] = useState<LocalNotificationItem[]>([]);
  const reminderTimeoutsRef = useRef<number[]>([]);

  // --- Initialization (Load from IndexedDB) ---
  useEffect(() => {
    const loadData = async () => {
        try {
            // Load Todos
            const loadedTodos = await db.getAll('todos');
            setTodos(loadedTodos.sort((a, b) => b.createdAt - a.createdAt));

            // Load Medicines
            const loadedMedicines = await db.getAll('medicines');
            const MS_DAY = 24 * 60 * 60 * 1000;
            const getTodayStart = () => {
                const now = new Date();
                return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            };
            const todayStart = getTodayStart();
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

        } catch (error) {
            console.error("Failed to load data from DB", error);
        }
    };
    loadData();
  }, []);

  // --- Handlers: Todos ---
  const addTodo = useCallback(async (text: string, priority: Priority = 'P4', dateOverride?: number, linkedNoteId?: string) => {
    if (!text.trim()) return;
    
    const now = Date.now();
    const newTodo: Todo = {
        id: crypto.randomUUID(),
        text: text.trim(),
        completed: false,
        createdAt: now,
        priority,
        dueDate: inputDueDate ? (() => {
            const [y, m, d] = inputDueDate.split('-').map(Number);
            return new Date(y, m - 1, d, 12, 0, 0).getTime();
        })() : undefined,
        linkedNotes: linkedNoteId ? [linkedNoteId] : undefined,
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
    await db.putItem('todos', newTodo);
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
        await db.softDeleteTodo(todoToDelete);
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
      if (!prev && next) {
        setNotificationInbox(items => items.map(item => ({ ...item, read: true })));
      }
      return next;
    });
  };

  const scheduleLocalNotification = (message: string, delayMinutes: number) => {
    const safeDelay = Math.max(0, Math.round(delayMinutes));
    const delayMs = safeDelay * 60 * 1000;
    const timeoutId = window.setTimeout(() => {
      setNotificationInbox(prev => [
        {
          id: crypto.randomUUID(),
          message,
          createdAt: Date.now(),
          read: false
        },
        ...prev
      ]);
    }, delayMs);
    reminderTimeoutsRef.current.push(timeoutId);
  };

  const updateReminderOption = (key: keyof ReminderOptions, checked: boolean) => {
    setReminderOptions(prev => ({ ...prev, [key]: checked }));
  };

  useEffect(() => {
    if (!isReminderPanelOpen) return;
    if (reminderEdited) return;
    if (reminderText !== inputValue) {
      setReminderText(inputValue);
    }
  }, [inputValue, isReminderPanelOpen, reminderEdited, reminderText]);

  useEffect(() => {
    return () => {
      reminderTimeoutsRef.current.forEach(id => clearTimeout(id));
      reminderTimeoutsRef.current = [];
    };
  }, []);

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
  const handleAddNote = async (note: NoteDoc) => {
      setNotes(prev => [note, ...prev]);
      await db.putItem('notes', note);
  };

  const handleUpdateNote = async (updatedNote: NoteDoc) => {
      setNotes(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));
      await db.putItem('notes', updatedNote);
  };

  const handleDeleteNote = async (id: string) => {
      setNotes(prev => prev.filter(n => n.id !== id));
      await db.deleteItem('notes', id);
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
        scheduleLocalNotification(textToSend, reminderDelayMinutes);
      }

      setReminderText('');
      setReminderEdited(false);
      setIsReminderPanelOpen(false);
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

  // --- Render Content Area ---
  const renderContent = () => {
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
                 <div className={`relative transition-all duration-300 ease-in-out ${isInputExpanded ? 'h-48' : 'h-24 sm:h-20'}`}>
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
                    />
                  ))}
                </div>
            )}
        </div>
    );
  };

  const unreadCount = notificationInbox.filter(n => !n.read).length;

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
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </button>

        {notificationCenterOpen && (
          <div className="mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-slate-400">Notificaciones</p>
              <button
                onClick={() => setNotificationCenterOpen(false)}
                className="text-slate-500 hover:text-white text-xs"
              >
                Cerrar
              </button>
            </div>
            {notificationInbox.length === 0 && (
              <p className="text-sm text-slate-500">Sin notificaciones.</p>
            )}
            {notificationInbox.map(item => (
              <div key={item.id} className="border border-slate-800 rounded-lg p-2 mb-2 last:mb-0 bg-slate-950/40">
                <p className="text-sm text-slate-200">{item.message}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {new Date(item.createdAt).toLocaleTimeString()}
                </p>
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

           {viewMode === ViewMode.NOTES && (
                <div className="max-w-5xl mx-auto mb-8">
                    <h2 className="text-3xl font-bold text-white mb-1 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent inline-block">
                        Notas
                    </h2>
                    <p className="text-slate-400 text-sm">Documentos y carpetas estilo Notion.</p>
                </div>
           )}

           {renderContent()}
      </main>

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
                  <p className="text-sm text-slate-200">Notificacion local programada</p>
                  <p className="text-xs text-slate-500">Aparece en el centro de notificaciones de la web.</p>
                  {reminderOptions.localNotification && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-slate-400">Minutos:</span>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={reminderDelayMinutes}
                        onChange={(e) => setReminderDelayMinutes(Number(e.target.value || 1))}
                        className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
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

