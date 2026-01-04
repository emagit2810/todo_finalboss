
import React, { useEffect, useState } from 'react';
import { Medicine } from '../types';
import { XMarkIcon, TrashIcon, PlusIcon, CheckIcon, BellIcon, CalendarIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';
import { sendReminder } from '../services/reminderService';

interface MedicinePanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  medicines: Medicine[];
  setMedicines: React.Dispatch<React.SetStateAction<Medicine[]>>;
  onAdd?: (med: Medicine) => void;
  onUpdate?: (med: Medicine) => void;
  onDelete?: (id: string) => void;
  embedded?: boolean;
  setNotification?: (n: { message: string, type: 'success' | 'error' }) => void;
}

export const MedicinePanel: React.FC<MedicinePanelProps> = ({ 
    isOpen, 
    onClose, 
    medicines, 
    setMedicines, 
    onAdd,
    onUpdate,
    onDelete,
    embedded = false,
    setNotification
}) => {
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [remainingInput, setRemainingInput] = useState(30);
  const [calendarAlarm, setCalendarAlarm] = useState(false);
  
  // Reminder State
  const [reminderText, setReminderText] = useState('');
  const [showReminder, setShowReminder] = useState(false);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [timeTick, setTimeTick] = useState(Date.now());

  const MS_DAY = 24 * 60 * 60 * 1000;
  const DEFAULT_REMAINING = 30;
  const MAX_REMAINING = 365;

  const getTodayStart = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  };

  const clampRemaining = (value: number) => Math.max(0, Math.min(MAX_REMAINING, value));

  const getRemainingForMedicine = (med: Medicine, todayStart = getTodayStart()) => {
    const lastUpdated = med.lastUpdated ?? todayStart;
    const remaining = Number.isFinite(med.remaining) ? med.remaining : DEFAULT_REMAINING;
    const daysPassed = Math.max(0, Math.floor((todayStart - lastUpdated) / MS_DAY));
    return Math.max(0, remaining - daysPassed);
  };

  useEffect(() => {
    const id = setInterval(() => setTimeTick(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const todayStart = getTodayStart();
    const updates: Record<string, Medicine> = {};
    let changed = false;

    for (const med of medicines) {
      const remaining = getRemainingForMedicine(med, todayStart);
      const alarmEnabled = med.alarmEnabled ?? false;
      const lastUpdated = med.lastUpdated ?? todayStart;
      if (
        remaining !== med.remaining ||
        lastUpdated !== todayStart ||
        med.remaining === undefined ||
        med.alarmEnabled === undefined
      ) {
        updates[med.id] = { ...med, remaining, lastUpdated: todayStart, alarmEnabled };
        changed = true;
      }
    }

    if (!changed) return;
    if (onUpdate) {
      Object.values(updates).forEach((updated) => onUpdate(updated));
    } else {
      setMedicines((prev) => prev.map((m) => updates[m.id] ?? m));
    }
  }, [medicines, onUpdate, setMedicines, timeTick]);

  const addMedicine = () => {
    if (!name.trim()) return;
    const todayStart = getTodayStart();
    const newMed: Medicine = {
      id: crypto.randomUUID(),
      name: name.trim(),
      dosage: dosage.trim(),
      taken: false,
      remaining: clampRemaining(remainingInput || DEFAULT_REMAINING),
      lastUpdated: todayStart,
      alarmEnabled: calendarAlarm,
    };
    
    // Use the specialized handler if available (for DB sync), otherwise fallback to setState
    if (onAdd) {
        onAdd(newMed);
    } else {
        setMedicines(prev => [...prev, newMed]);
    }
    
    setName('');
    setDosage('');
    setRemainingInput(DEFAULT_REMAINING);
    setCalendarAlarm(false);
    setReminderText('');
    setShowReminder(false);
  };

  const toggleTaken = (id: string) => {
    const medToUpdate = medicines.find(m => m.id === id);
    if (medToUpdate) {
        const updated = { ...medToUpdate, taken: !medToUpdate.taken };
        if (onUpdate) {
            onUpdate(updated);
        } else {
             setMedicines(prev => prev.map(m => m.id === id ? updated : m));
        }
    }
  };

  const deleteMedicine = (id: string) => {
    if (onDelete) {
        onDelete(id);
    } else {
        setMedicines(prev => prev.filter(m => m.id !== id));
    }
  };

  const updateRemaining = (med: Medicine, delta: number) => {
    const todayStart = getTodayStart();
    const current = getRemainingForMedicine(med, todayStart);
    const next = clampRemaining(current + delta);
    const updated = { ...med, remaining: next, lastUpdated: todayStart };
    if (onUpdate) {
      onUpdate(updated);
    } else {
      setMedicines((prev) => prev.map((m) => (m.id === med.id ? updated : m)));
    }
  };

  const setRemainingExact = (med: Medicine, value: number) => {
    const todayStart = getTodayStart();
    const next = clampRemaining(value);
    const updated = { ...med, remaining: next, lastUpdated: todayStart };
    if (onUpdate) {
      onUpdate(updated);
    } else {
      setMedicines((prev) => prev.map((m) => (m.id === med.id ? updated : m)));
    }
  };

  const toggleCalendarAlarm = (med: Medicine) => {
    const updated = { ...med, alarmEnabled: !med.alarmEnabled };
    if (onUpdate) {
      onUpdate(updated);
    } else {
      setMedicines((prev) => prev.map((m) => (m.id === med.id ? updated : m)));
    }
  };

  const handleSendReminder = async () => {
      const text = reminderText || `Remember to take ${name || 'medicine'}`;
      setReminderLoading(true);
      const res = await sendReminder(text, { type: 'MEDICINE' });
      setReminderLoading(false);

      if (setNotification) {
          setNotification({ 
              message: res.success ? res.message : (res.message || "Failed to send"), 
              type: res.success ? 'success' : 'error' 
          });
      }
      if (res.success) {
          setReminderText('');
          setShowReminder(false);
      }
  };

  if (!embedded) {
    // Drawer Mode
    return (
        <div 
          className={`fixed top-0 right-0 h-full w-80 bg-slate-900 border-l border-slate-800 shadow-2xl transform transition-transform duration-300 ease-in-out z-50 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="p-5 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-100">Medicine Tracker</h2>
              {onClose && (
                <button onClick={onClose} className="text-slate-400 hover:text-white">
                  <XMarkIcon className="w-6 h-6" />
                </button>
              )}
            </div>
            {renderContent()}
          </div>
        </div>
      );
  }

  // Embedded Mode
  return (
      <div className="w-full h-full flex flex-col animate-in fade-in duration-300 max-w-3xl mx-auto">
          <div className="mb-6">
              <h2 className="text-3xl font-bold text-white mb-1 bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent inline-block">Medicine Tracker</h2>
              <p className="text-slate-400 text-sm">Track your daily intake and prescriptions.</p>
          </div>
          {renderContent()}
      </div>
  );

  function renderContent() {
      return (
        <>
            {/* Add Form */}
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-6">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Add Medication</h3>
              <div className="space-y-3">
                <input 
                  type="text" 
                  placeholder="Name (e.g. Bupropion)" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
                />
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Dosage (150mg)" 
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
                  />
                  <div className="flex items-center bg-slate-900 border border-slate-700 rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setRemainingInput((prev) => clampRemaining(prev - 1))}
                      className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 border-r border-slate-800"
                      title="Decrease"
                    >
                      <ChevronDownIcon className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={MAX_REMAINING}
                      value={remainingInput}
                      onChange={(e) => setRemainingInput(clampRemaining(Number(e.target.value || 0)))}
                      className="w-14 bg-transparent text-center text-sm text-slate-200 focus:outline-none"
                      title="Days left"
                    />
                    <button
                      type="button"
                      onClick={() => setRemainingInput((prev) => clampRemaining(prev + 1))}
                      className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 border-l border-slate-800"
                      title="Increase"
                    >
                      <ChevronUpIcon className="w-3 h-3" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCalendarAlarm((prev) => !prev)}
                    className={`px-3 rounded-md border transition-colors ${calendarAlarm ? 'bg-amber-900/40 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'}`}
                    title="Add calendar alarm"
                  >
                    <CalendarIcon className="w-4 h-4" />
                  </button>

                  {/* Reminder Toggle Button */}
                   <button 
                    onClick={() => setShowReminder(!showReminder)}
                    className={`px-3 rounded-md border transition-colors ${showReminder ? 'bg-indigo-900/50 border-indigo-500 text-indigo-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'}`}
                    title="Send Reminder"
                  >
                    <BellIcon className="w-4 h-4" />
                  </button>
                </div>

                {/* Reminder Input Section */}
                {showReminder && (
                    <div className="flex gap-2 animate-in slide-in-from-top-1">
                        <input 
                            type="text"
                            value={reminderText}
                            onChange={(e) => setReminderText(e.target.value)}
                            placeholder={`Reminder msg: Take ${name || '...'}`}
                            className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                        />
                        <button 
                            onClick={handleSendReminder}
                            disabled={reminderLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 rounded-md"
                        >
                            {reminderLoading ? '...' : 'Send'}
                        </button>
                    </div>
                )}

                <button 
                  onClick={addMedicine}
                  className="w-full bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium py-2 rounded-md flex items-center justify-center gap-2 transition-colors"
                >
                  <PlusIcon className="w-4 h-4" /> Add
                </button>
              </div>
            </div>
    
            {/* List */}
            <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
               {medicines.length === 0 && (
                   <p className="text-slate-500 text-center text-sm mt-10">No medicines being tracked.</p>
               )}
               {medicines.map(med => (
                 <div key={med.id} className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex items-center justify-between group">
                   <div className="flex items-center gap-3">
                     <button 
                       onClick={() => toggleTaken(med.id)}
                       className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${med.taken ? 'bg-green-500 border-green-500' : 'border-slate-500 hover:border-primary-500'}`}
                     >
                        {med.taken && <CheckIcon className="w-3.5 h-3.5 text-white" />}
                     </button>
                     <div>
                       <p className={`font-medium text-sm ${med.taken ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{med.name}</p>
                       <p className="text-xs text-slate-500">{med.dosage} - {getRemainingForMedicine(med)} left</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-1">
                     <div className="flex items-center bg-slate-900 rounded-md border border-slate-700 overflow-hidden">
                       <button
                         type="button"
                         onClick={() => updateRemaining(med, -1)}
                         className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 border-r border-slate-800"
                         title="Decrease"
                       >
                         <ChevronDownIcon className="w-3 h-3" />
                       </button>
                       <input
                         type="number"
                         min={0}
                         max={MAX_REMAINING}
                         value={getRemainingForMedicine(med)}
                         onChange={(e) => setRemainingExact(med, Number(e.target.value || 0))}
                         className="w-12 bg-transparent text-center text-xs text-slate-200 focus:outline-none"
                         title="Days left"
                       />
                       <button
                         type="button"
                         onClick={() => updateRemaining(med, 1)}
                         className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 border-l border-slate-800"
                         title="Increase"
                       >
                         <ChevronUpIcon className="w-3 h-3" />
                       </button>
                     </div>
                     <button
                       onClick={() => toggleCalendarAlarm(med)}
                       className={`p-2 rounded-md transition-colors ${med.alarmEnabled ? 'text-amber-300 bg-amber-900/40' : 'text-slate-500 hover:text-amber-300 hover:bg-slate-700/50'}`}
                       title="Toggle calendar alarm"
                     >
                       <CalendarIcon className="w-4 h-4" />
                     </button>
                     <button onClick={() => deleteMedicine(med.id)} className="text-slate-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                       <TrashIcon className="w-4 h-4" />
                     </button>
                   </div>
                 </div>
               ))}
            </div>
        </>
      );
  }
};
