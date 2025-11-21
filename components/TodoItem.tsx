
import React, { useState } from 'react';
import { Todo, Priority, Subtask } from '../types';
import { CheckIcon, TrashIcon, SpeakerIcon, FlagIcon, ChevronUpIcon, ChevronDownIcon, PlusIcon, XMarkIcon, ClockIcon } from './Icons';
import { speakText } from '../services/geminiService';

interface TodoItemProps {
  todo: Todo;
  onUpdate: (todo: Todo) => void;
  onDelete: (id: string) => void;
}

export const TodoItem: React.FC<TodoItemProps> = ({ todo, onUpdate, onDelete }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');

  const handleSpeak = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) return;
    setIsPlaying(true);
    try {
        const textToSpeak = `${todo.text}. ${todo.description || ''}. ${todo.subtasks?.length ? 'Steps: ' + todo.subtasks.map(s => s.text).join(', ') : ''}`;
        const audioData = await speakText(textToSpeak);
        if (audioData) {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const buffer = await ctx.decodeAudioData(audioData);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(0);
            source.onended = () => setIsPlaying(false);
        } else {
            setIsPlaying(false);
        }
    } catch (e) {
        console.error(e);
        setIsPlaying(false);
    }
  };

  const getPriorityColor = (p?: Priority) => {
    switch(p) {
        case 'P1': return 'text-red-500';
        case 'P2': return 'text-orange-400';
        case 'P3': return 'text-blue-400';
        default: return 'text-slate-600';
    }
  };

  const cyclePriority = (e: React.MouseEvent) => {
      e.stopPropagation();
      const next: Record<string, Priority> = {
          'P1': 'P2',
          'P2': 'P3',
          'P3': 'P4',
          'P4': 'P1',
          'undefined': 'P1'
      };
      const current = todo.priority || 'P4';
      onUpdate({ ...todo, priority: next[current] });
  };

  const updateComplexity = (delta: number) => {
      const current = todo.complexity || 1;
      const newVal = Math.max(1, Math.min(10, current + delta));
      onUpdate({ ...todo, complexity: newVal });
  };

  const toggleSubtask = (id: string) => {
      const updatedSubtasks = (todo.subtasks || []).map(s => 
        s.id === id ? { ...s, completed: !s.completed } : s
      );
      onUpdate({ ...todo, subtasks: updatedSubtasks });
  };

  const deleteSubtask = (id: string) => {
      const updatedSubtasks = (todo.subtasks || []).filter(s => s.id !== id);
      onUpdate({ ...todo, subtasks: updatedSubtasks });
  };

  const addSubtask = () => {
      if (!newSubtask.trim()) return;
      const step: Subtask = {
          id: crypto.randomUUID(),
          text: newSubtask.trim(),
          completed: false
      };
      onUpdate({ ...todo, subtasks: [...(todo.subtasks || []), step] });
      setNewSubtask('');
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const dateVal = e.target.value; // yyyy-mm-dd
      if (dateVal) {
          // Create date at noon to avoid timezone flips
          const [y, m, d] = dateVal.split('-').map(Number);
          const newDate = new Date(y, m - 1, d, 12, 0, 0);
          onUpdate({ ...todo, dueDate: newDate.getTime() });
      } else {
          onUpdate({ ...todo, dueDate: undefined });
      }
  };

  return (
    <div className="group bg-slate-800/50 hover:bg-slate-800 p-4 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-all duration-200 mb-4 shadow-sm">
      {/* Top Row: Title, Priority, Complexity */}
      <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            {/* Main Checkbox */}
            <button
              onClick={() => onUpdate({ ...todo, completed: !todo.completed })}
              className={`
                flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors duration-200 mt-0.5
                ${todo.completed 
                  ? 'bg-green-500 border-green-500' 
                  : 'border-slate-500 hover:border-primary-500'
                }
              `}
            >
              {todo.completed && <CheckIcon className="w-4 h-4 text-white" />}
            </button>

            <div className="flex flex-col w-full">
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Title */}
                    <input 
                        type="text"
                        value={todo.text}
                        onChange={(e) => onUpdate({ ...todo, text: e.target.value })}
                        className={`bg-transparent border-none focus:outline-none text-lg font-medium w-full sm:w-auto flex-1 ${todo.completed ? 'line-through text-slate-500' : 'text-slate-100'}`}
                    />
                    
                    {/* Complexity Counter */}
                    <div className="flex items-center bg-slate-900 rounded-lg border border-slate-700 hidden sm:flex">
                        <button 
                            onClick={() => updateComplexity(-1)}
                            className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-l-lg border-r border-slate-800"
                        >
                            <ChevronDownIcon className="w-3 h-3" />
                        </button>
                        <span className="px-3 text-sm font-mono font-bold text-slate-200 w-8 text-center">
                            {todo.complexity || 1}
                        </span>
                         <button 
                            onClick={() => updateComplexity(1)}
                            className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-r-lg border-l border-slate-800"
                        >
                             <ChevronUpIcon className="w-3 h-3" />
                        </button>
                    </div>

                    {/* Priority Flag */}
                    <button 
                        onClick={cyclePriority}
                        className={`flex items-center gap-1 text-xs font-medium hover:bg-slate-700 px-2 py-1 rounded transition-colors border border-transparent hover:border-slate-600 ${getPriorityColor(todo.priority || 'P4')}`}
                        title="Change priority"
                    >
                        <FlagIcon className="w-3.5 h-3.5" />
                        {todo.priority || 'P4'}
                    </button>
                </div>

                {/* Date Row */}
                <div className="flex items-center gap-2 mt-1">
                    <ClockIcon className="w-3 h-3 text-slate-500" />
                    <input 
                        type="date"
                        value={todo.dueDate ? new Date(todo.dueDate).toISOString().split('T')[0] : ''}
                        onChange={handleDateChange}
                        className="bg-transparent text-xs text-slate-400 hover:text-slate-200 focus:outline-none focus:text-white border-b border-transparent focus:border-slate-600 transition-colors w-28"
                    />
                </div>
            </div>
          </div>
          
          {/* Actions */}
           <div className="flex items-center gap-1">
                <button 
                    onClick={handleSpeak}
                    disabled={isPlaying}
                    className={`p-2 rounded-lg hover:bg-slate-700 transition-colors ${isPlaying ? 'text-primary-400 animate-pulse' : 'text-slate-400 hover:text-primary-400'}`}
                >
                    <SpeakerIcon className="w-5 h-5" />
                </button>
                <button 
                onClick={() => onDelete(todo.id)}
                className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                >
                <TrashIcon className="w-5 h-5" />
                </button>
            </div>
      </div>

      {/* Description Section */}
      <div className="mt-3 pl-9">
          <div className="relative">
            <textarea
                value={todo.description || ''}
                onChange={(e) => onUpdate({ ...todo, description: e.target.value })}
                placeholder="Add a more detailed description..."
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-slate-600 focus:bg-slate-900 transition-all resize-none min-h-[60px]"
            />
          </div>
      </div>

      {/* Subtasks Section */}
      <div className="mt-3 pl-9">
         <div className="space-y-2">
            {(todo.subtasks || []).map((step, index) => (
                <div key={step.id} className="flex items-center gap-3 group/sub">
                    <span className="text-slate-600 font-mono text-xs w-4 text-right">{index + 1}.</span>
                    <button 
                        onClick={() => toggleSubtask(step.id)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${step.completed ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600 hover:border-indigo-400'}`}
                    >
                        {step.completed && <CheckIcon className="w-3 h-3 text-white" />}
                    </button>
                    <span className={`text-sm flex-1 ${step.completed ? 'line-through text-slate-500' : 'text-slate-300'}`}>
                        {step.text}
                    </span>
                    <button 
                        onClick={() => deleteSubtask(step.id)}
                        className="opacity-0 group-hover/sub:opacity-100 text-slate-500 hover:text-red-400"
                    >
                        <XMarkIcon className="w-4 h-4" />
                    </button>
                </div>
            ))}
         </div>

         {/* Add Subtask Input */}
         <div className="flex items-center gap-3 mt-2">
             <span className="w-4" /> {/* Spacer for numbering alignment */}
             <div className="relative flex-1">
                <input 
                    type="text"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                    placeholder="Add a step..."
                    className="w-full bg-transparent border-b border-slate-700/50 py-1 text-sm text-slate-300 focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                />
                <button 
                    onClick={addSubtask}
                    className="absolute right-0 top-1 text-slate-500 hover:text-indigo-400"
                >
                    <PlusIcon className="w-4 h-4" />
                </button>
             </div>
         </div>
      </div>
    </div>
  );
};
