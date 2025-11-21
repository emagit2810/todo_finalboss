
import React, { useState } from 'react';
import { Medicine } from '../types';
import { XMarkIcon, TrashIcon, PlusIcon, CheckIcon, BellIcon } from './Icons';
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
  const [time, setTime] = useState('Morning');
  
  // Reminder State
  const [reminderText, setReminderText] = useState('');
  const [showReminder, setShowReminder] = useState(false);
  const [reminderLoading, setReminderLoading] = useState(false);

  const addMedicine = () => {
    if (!name.trim()) return;
    const newMed: Medicine = {
      id: crypto.randomUUID(),
      name: name.trim(),
      dosage: dosage.trim(),
      time,
      taken: false,
    };
    
    // Use the specialized handler if available (for DB sync), otherwise fallback to setState
    if (onAdd) {
        onAdd(newMed);
    } else {
        setMedicines(prev => [...prev, newMed]);
    }
    
    setName('');
    setDosage('');
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
                  <select 
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-md px-2 py-2 text-sm focus:outline-none focus:border-primary-500"
                  >
                    <option>Morning</option>
                    <option>Noon</option>
                    <option>Night</option>
                  </select>

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
                       <p className="text-xs text-slate-500">{med.dosage} • {med.time}</p>
                     </div>
                   </div>
                   <button onClick={() => deleteMedicine(med.id)} className="text-slate-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                     <TrashIcon className="w-4 h-4" />
                   </button>
                 </div>
               ))}
            </div>
        </>
      );
  }
};
