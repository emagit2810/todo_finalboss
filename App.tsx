
import React, { useState, useEffect, useCallback } from 'react';
import { Todo, ViewMode, Medicine, Expense, Priority, Subtask } from './types';
import { TodoItem } from './components/TodoItem';
import { brainstormTasks } from './services/geminiService';
import { PlusIcon, BrainIcon, ArrowsExpandIcon, ArrowsCollapseIcon, FlagIcon, BellIcon, ClockIcon } from './components/Icons';
import { MedicinePanel } from './components/MedicinePanel';
import { ExpensesPanel } from './components/ExpensesPanel';
import { CalendarPanel } from './components/CalendarPanel';
import { Sidebar } from './components/Sidebar';
import * as db from './services/db';
import { sendReminder } from './services/reminderService';
import { Toast } from './components/Toast';

function App() {
  // --- State: Todos ---
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filterPriority, setFilterPriority] = useState<Priority | 'ALL'>('ALL');
  
  // --- State: Medicines ---
  const [medicines, setMedicines] = useState<Medicine[]>([]);

  // --- State: Expenses ---
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // --- State: UI ---
  const [inputValue, setInputValue] = useState('');
  const [inputPriority, setInputPriority] = useState<Priority>('P4'); // Default priority for new task
  const [inputDueDate, setInputDueDate] = useState(''); // YYYY-MM-DD string
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.LIST);
  const [brainstormQuery, setBrainstormQuery] = useState('');
  const [brainstormLoading, setBrainstormLoading] = useState(false);
  const [brainstormSources, setBrainstormSources] = useState<Array<{uri: string, title: string}>>([]);

  // --- State: Reminder / Notification ---
  const [showReminderInput, setShowReminderInput] = useState(false);
  const [reminderText, setReminderText] = useState('');
  const [reminderLoading, setReminderLoading] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // --- Initialization (Load from IndexedDB) ---
  useEffect(() => {
    const loadData = async () => {
        try {
            // Load Todos
            const loadedTodos = await db.getAll('todos');
            setTodos(loadedTodos.sort((a, b) => b.createdAt - a.createdAt));

            // Load Medicines
            const loadedMedicines = await db.getAll('medicines');
            setMedicines(loadedMedicines);

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

        } catch (error) {
            console.error("Failed to load data from DB", error);
        }
    };
    loadData();
  }, []);

  // --- Handlers: Todos ---
  const addTodo = useCallback(async (text: string, priority: Priority = 'P4', dateOverride?: number) => {
    if (!text.trim()) return;

    let dueTimestamp: number | undefined = undefined;
    if (dateOverride) {
        dueTimestamp = dateOverride;
    } else if (inputDueDate) {
         const [y, m, d] = inputDueDate.split('-').map(Number);
         dueTimestamp = new Date(y, m - 1, d, 12, 0, 0).getTime();
    }

    const newTodo: Todo = {
      id: crypto.randomUUID(),
      text: text.trim(),
      completed: false,
      createdAt: Date.now(),
      priority: priority,
      complexity: 1,
      subtasks: [],
      dueDate: dueTimestamp
    };
    
    // Optimistic Update
    setTodos(prev => [newTodo, ...prev]);
    setInputValue('');
    setInputPriority('P4'); // Reset to default
    setInputDueDate(''); // Reset date
    setReminderText(''); // Reset reminder
    setShowReminderInput(false);
    
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

  // --- Handler: Reminder ---
  const handleSendReminder = async () => {
      const textToSend = reminderText || inputValue;
      if (!textToSend) {
          setNotification({ message: 'Please enter text for the reminder', type: 'error' });
          return;
      }
      
      setReminderLoading(true);
      const res = await sendReminder(textToSend, { priority: inputPriority, type: 'TODO' });
      setReminderLoading(false);
      
      if (res.success) {
          setNotification({ message: res.message, type: 'success' });
          setReminderText('');
          setShowReminderInput(false);
      } else {
          setNotification({ message: res.message, type: 'error' });
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
    const lines = result.text.split('\n').filter(l => l.trim().length > 0);
    const newSubtasks: Subtask[] = [];

    for (const line of lines) {
      // Remove markdown bullets, numbers, etc.
      const cleanText = line.replace(/^[\d\.\-\*\s]+/, '').trim();
      if (cleanText && cleanText.length > 2) {
        newSubtasks.push({
            id: crypto.randomUUID(),
            text: cleanText,
            completed: false
        });
      }
    }

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
                onUpdateTodo={handleUpdateTodo}
                onAddTodo={(text, priority, date) => addTodo(text, priority, date)}
            />
        );
    }

    // Filtered Todos
    const filteredTodos = filterPriority === 'ALL' 
        ? todos 
        : todos.filter(t => (t.priority || 'P4') === filterPriority);

    return (
        <div className="max-w-3xl mx-auto">
            {/* Input Section */}
            <div className="mb-8">
              {viewMode === ViewMode.LIST ? (
                 <div className={`relative transition-all duration-300 ease-in-out ${isInputExpanded || showReminderInput ? 'h-48' : 'h-24 sm:h-20'}`}>
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
                     
                     {/* Reminder Button (Toggles extra input) */}
                     <button
                        onClick={() => setShowReminderInput(!showReminderInput)}
                        className={`p-2 rounded-lg transition-colors ${showReminderInput ? 'text-indigo-400 bg-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                        title="Add Reminder Note"
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
                   </div>

                   {/* Reminder Popover / Extra Input */}
                   {showReminderInput && (
                       <div className="absolute bottom-16 right-0 w-full sm:w-96 bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl z-30 animate-in slide-in-from-bottom-2">
                           <div className="flex gap-2">
                               <input 
                                    type="text"
                                    value={reminderText}
                                    onChange={(e) => setReminderText(e.target.value)}
                                    placeholder="Message for AI Reminder..."
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                               />
                               <button 
                                    onClick={handleSendReminder}
                                    disabled={reminderLoading}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-sm font-medium disabled:opacity-50"
                               >
                                   {reminderLoading ? '...' : 'Send'}
                               </button>
                           </div>
                           <p className="text-[10px] text-slate-500 mt-1">Sends notification to configured endpoint</p>
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
                  {filteredTodos.map(todo => (
                    <TodoItem 
                      key={todo.id} 
                      todo={todo} 
                      onUpdate={handleUpdateTodo}
                      onDelete={deleteTodo} 
                    />
                  ))}
                </div>
            )}
        </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans selection:bg-primary-500/30 overflow-hidden relative">
      {/* Toast Notification Layer */}
      {notification && (
        <Toast 
            message={notification.message} 
            type={notification.type} 
            onClose={() => setNotification(null)} 
        />
      )}

      {/* Sidebar Navigation */}
      <Sidebar 
        currentView={viewMode} 
        setViewMode={setViewMode} 
        currentPriorityFilter={filterPriority}
        setPriorityFilter={setFilterPriority}
      />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 pt-12 scroll-smooth">
           {/* Page Title (dynamic based on view) */}
           {viewMode === ViewMode.LIST && (
               <div className="max-w-3xl mx-auto mb-8">
                   <h2 className="text-3xl font-bold text-white mb-1 bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent inline-block">
                       My Tasks
                   </h2>
                   <p className="text-slate-400 text-sm">
                       {filterPriority === 'ALL' ? 'Voice-powered & AI-grounded workspace' : `Showing ${filterPriority} Priority Tasks`}
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
    </div>
  );
}

export default App;
