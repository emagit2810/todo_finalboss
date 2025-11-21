
import React, { useState } from 'react';
import { Todo, Priority } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon } from './Icons';

interface CalendarPanelProps {
  todos: Todo[];
  onUpdateTodo: (todo: Todo) => void;
  onAddTodo: (text: string, priority: Priority, date: number) => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CalendarPanel: React.FC<CalendarPanelProps> = ({ todos, onUpdateTodo, onAddTodo }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [newTaskText, setNewTaskText] = useState('');

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const resetToday = () => setCurrentDate(new Date());

  const getPriorityColorBg = (p: Priority) => {
    switch(p) {
        case 'P1': return 'bg-red-500';
        case 'P2': return 'bg-orange-400';
        case 'P3': return 'bg-blue-400';
        default: return 'bg-slate-600';
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedDate || !newTaskText.trim()) return;
      
      // Set time to noon to avoid timezone rollover issues when storing simplified date
      const due = new Date(selectedDate);
      due.setHours(12, 0, 0, 0);
      
      onAddTodo(newTaskText, 'P2', due.getTime());
      setNewTaskText('');
      setSelectedDate(null); // Close modal/selection
  };

  // Helper to compare dates disregarding time
  const isSameDay = (d1: Date, d2: Date) => {
      return d1.getDate() === d2.getDate() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getFullYear() === d2.getFullYear();
  };

  // Filter tasks for a specific day
  const getTasksForDay = (day: number) => {
      const target = new Date(year, month, day);
      return todos.filter(t => {
          if (!t.dueDate) return false;
          const tDate = new Date(t.dueDate);
          return isSameDay(tDate, target);
      });
  };

  const renderCells = () => {
    const cells = [];
    // Empty cells for padding
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className="min-h-[120px] bg-slate-900/30 border border-slate-800/50 opacity-50" />);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month, day);
      const isToday = isSameDay(new Date(), dateObj);
      const tasks = getTasksForDay(day);

      cells.push(
        <div 
            key={day} 
            onClick={() => setSelectedDate(dateObj)}
            className={`
                min-h-[120px] p-2 border border-slate-800 bg-slate-900/80 hover:bg-slate-800 transition-colors cursor-pointer relative group
                ${isToday ? 'ring-1 ring-inset ring-primary-500 bg-primary-900/10' : ''}
            `}
        >
          <div className="flex justify-between items-start mb-2">
            <span className={`
                text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full
                ${isToday ? 'bg-primary-600 text-white' : 'text-slate-400'}
            `}>
                {day}
            </span>
            {/* Hover 'Add' indicator */}
            <span className="opacity-0 group-hover:opacity-100 text-xs text-slate-500">+</span>
          </div>
          
          <div className="space-y-1 overflow-y-auto max-h-[80px] no-scrollbar">
            {tasks.map(task => (
                <div 
                    key={task.id} 
                    onClick={(e) => {
                        e.stopPropagation();
                        // Optionally open detail view, for now just toggle complete
                        onUpdateTodo({...task, completed: !task.completed});
                    }}
                    className={`
                        text-[10px] px-1.5 py-1 rounded truncate flex items-center gap-1 border border-transparent hover:border-slate-600 transition-all
                        ${task.completed ? 'opacity-50 line-through bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-200'}
                    `}
                    title={task.text}
                >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getPriorityColorBg(task.priority)}`} />
                    {task.text}
                </div>
            ))}
          </div>
        </div>
      );
    }
    return cells;
  };

  return (
    <div className="h-full flex flex-col pb-20 max-w-6xl mx-auto animate-in fade-in duration-300">
       {/* Header */}
       <div className="flex items-center justify-between mb-6">
         <div>
            <h2 className="text-3xl font-bold text-white mb-1">
                {currentDate.toLocaleString('default', { month: 'long' })} {year}
            </h2>
            <p className="text-slate-400 text-sm">Plan your schedule</p>
         </div>
         <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white"><ChevronLeftIcon className="w-5 h-5" /></button>
            <button onClick={resetToday} className="px-3 py-1 rounded border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800">Today</button>
            <button onClick={nextMonth} className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white"><ChevronRightIcon className="w-5 h-5" /></button>
         </div>
       </div>

       {/* Weekday Header */}
       <div className="grid grid-cols-7 gap-px mb-px">
            {DAYS.map(day => (
                <div key={day} className="text-center py-2 text-sm font-semibold text-slate-500 uppercase tracking-wider">
                    {day}
                </div>
            ))}
       </div>

       {/* Calendar Grid */}
       <div className="grid grid-cols-7 auto-rows-fr gap-px bg-slate-800 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
            {renderCells()}
       </div>

       {/* Add Task Modal (Simple Overlay) */}
       {selectedDate && (
           <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setSelectedDate(null)}>
               <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                   <h3 className="text-lg font-bold text-white mb-4">
                       Add Task for {selectedDate.toLocaleDateString()}
                   </h3>
                   <form onSubmit={handleAddTask}>
                       <input 
                         autoFocus
                         type="text" 
                         value={newTaskText}
                         onChange={e => setNewTaskText(e.target.value)}
                         placeholder="What needs to be done?"
                         className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary-500 mb-4"
                       />
                       <div className="flex justify-end gap-3">
                           <button 
                             type="button" 
                             onClick={() => setSelectedDate(null)}
                             className="px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-800"
                           >
                               Cancel
                           </button>
                           <button 
                             type="submit"
                             className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium"
                           >
                               Add Task
                           </button>
                       </div>
                   </form>
               </div>
           </div>
       )}
    </div>
  );
};
