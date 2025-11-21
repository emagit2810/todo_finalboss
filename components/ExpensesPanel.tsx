
import React, { useState } from 'react';
import { Expense } from '../types';
import { BanknotesIcon, PlusIcon, TrashIcon } from './Icons';

interface ExpensesPanelProps {
  expenses: Expense[];
  onAdd: (expense: Expense) => void;
  onUpdate?: (expense: Expense) => void;
  onDelete: (id: string) => void;
}

export const ExpensesPanel: React.FC<ExpensesPanelProps> = ({ expenses, onAdd, onUpdate, onDelete }) => {
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState<string>('');
  const [newCategory, setNewCategory] = useState<'A' | 'B'>('A');
  const [newFrequency, setNewFrequency] = useState<'weekly' | 'monthly'>('weekly');

  // --- Calculation Logic ---
  const calculateMonthly = (amount: number, freq: 'weekly' | 'monthly') => {
    return freq === 'weekly' ? amount * 4.33 : amount;
  };

  const calculateWeekly = (amount: number, freq: 'weekly' | 'monthly') => {
    return freq === 'weekly' ? amount : amount / 4.33;
  };

  const totals = {
    semanalA: expenses.filter(e => e.category === 'A').reduce((sum, e) => sum + calculateWeekly(e.amount, e.frequency), 0),
    mensualA: expenses.filter(e => e.category === 'A').reduce((sum, e) => sum + calculateMonthly(e.amount, e.frequency), 0),
    semanalB: expenses.filter(e => e.category === 'B').reduce((sum, e) => sum + calculateWeekly(e.amount, e.frequency), 0),
    mensualB: expenses.filter(e => e.category === 'B').reduce((sum, e) => sum + calculateMonthly(e.amount, e.frequency), 0)
  };

  const formatear = (num: number) => `$${num.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

  const handleAdd = () => {
    const val = parseFloat(newAmount);
    if (!newTitle || isNaN(val)) return;

    const newExpense: Expense = {
      id: crypto.randomUUID(),
      title: newTitle,
      amount: val,
      category: newCategory,
      frequency: newFrequency,
      date: Date.now()
    };

    onAdd(newExpense);
    setNewTitle('');
    setNewAmount('');
  };

  const updateField = (expense: Expense, field: keyof Expense, value: any) => {
      if (!onUpdate) return;
      onUpdate({ ...expense, [field]: value });
  };

  const renderTable = (category: 'A' | 'B', title: string, colorClass: string, borderColor: string) => (
    <div className={`bg-slate-900 rounded-xl shadow-lg p-6 mb-6 border ${borderColor}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-xl font-bold ${colorClass}`}>
          {title}
        </h2>
        <div className="text-right text-sm">
             <span className="text-slate-500 block">Monthly Total</span>
             <span className={`font-mono font-bold ${colorClass}`}>
                {formatear(category === 'A' ? totals.mensualA : totals.mensualB)}
             </span>
        </div>
      </div>
      
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="p-3 rounded-l-lg">Gasto</th>
              <th className="p-3">Freq</th>
              <th className="p-3 text-right">Semanal</th>
              <th className="p-3 text-right">Mensual</th>
              <th className="p-3 text-right">Total/Mes</th>
              <th className="p-3 rounded-r-lg w-10"></th>
            </tr>
          </thead>
          <tbody className="text-sm text-slate-300">
            {expenses.filter(e => e.category === category).map((gasto) => {
               const monthlyVal = calculateMonthly(gasto.amount, gasto.frequency);
               
               return (
                <tr key={gasto.id} className="border-b border-slate-800 hover:bg-slate-800/30 transition-colors">
                  <td className="p-3">
                    <input
                      value={gasto.title}
                      onChange={(e) => updateField(gasto, 'title', e.target.value)}
                      className="w-full bg-transparent border-b border-transparent focus:border-primary-500 focus:outline-none py-1"
                    />
                  </td>
                  <td className="p-3">
                    <select
                      value={gasto.frequency}
                      onChange={(e) => updateField(gasto, 'frequency', e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-primary-500"
                    >
                      <option value="weekly">Semanal</option>
                      <option value="monthly">Mensual</option>
                    </select>
                  </td>
                  {/* Semanal Input */}
                  <td className="p-3">
                    <input
                      type="number"
                      value={gasto.frequency === 'weekly' ? gasto.amount : ''}
                      placeholder={gasto.frequency === 'monthly' ? '-' : ''}
                      onChange={(e) => updateField(gasto, 'amount', parseFloat(e.target.value) || 0)}
                      disabled={gasto.frequency === 'monthly'}
                      className="w-full text-right bg-transparent border-b border-slate-800 focus:border-primary-500 focus:outline-none py-1 disabled:opacity-30"
                    />
                  </td>
                  {/* Mensual Input */}
                  <td className="p-3">
                    <input
                      type="number"
                      value={gasto.frequency === 'monthly' ? gasto.amount : ''}
                      placeholder={gasto.frequency === 'weekly' ? '-' : ''}
                      onChange={(e) => updateField(gasto, 'amount', parseFloat(e.target.value) || 0)}
                      disabled={gasto.frequency === 'weekly'}
                      className="w-full text-right bg-transparent border-b border-slate-800 focus:border-primary-500 focus:outline-none py-1 disabled:opacity-30"
                    />
                  </td>
                  <td className="p-3 text-right font-mono font-semibold text-slate-200">
                    {formatear(monthlyVal)}
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => onDelete(gasto.id)}
                      className="text-slate-600 hover:text-red-500 transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col animate-in fade-in duration-300 max-w-5xl mx-auto pb-20">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-white mb-1 bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent inline-block">
          Gastos Tracker
        </h2>
        <p className="text-slate-400 text-sm">Control de finanzas personales (COP).</p>
      </div>

      {/* Summaries */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Category A Summary */}
        <div className="bg-indigo-900/20 rounded-xl p-6 border border-indigo-500/30 backdrop-blur-sm">
          <h2 className="text-lg font-bold text-indigo-300 mb-4">Categoría A - Principal</h2>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-indigo-400/80 text-sm">Total Semanal:</span>
              <span className="font-bold text-indigo-200 font-mono">{formatear(totals.semanalA)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-indigo-500/20">
              <span className="text-indigo-400 text-base">Total Mensual:</span>
              <span className="font-bold text-indigo-100 text-lg font-mono">{formatear(totals.mensualA)}</span>
            </div>
          </div>
        </div>

        {/* Category B Summary */}
        <div className="bg-emerald-900/20 rounded-xl p-6 border border-emerald-500/30 backdrop-blur-sm">
          <h2 className="text-lg font-bold text-emerald-300 mb-4">Categoría B - Otros</h2>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-emerald-400/80 text-sm">Total Semanal:</span>
              <span className="font-bold text-emerald-200 font-mono">{formatear(totals.semanalB)}</span>
            </div>
             <div className="flex justify-between items-center pt-2 border-t border-emerald-500/20">
              <span className="text-emerald-400 text-base">Total Mensual:</span>
              <span className="font-bold text-emerald-100 text-lg font-mono">{formatear(totals.mensualB)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Grand Total */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-xl p-6 mb-8 text-white shadow-xl border border-slate-600/50">
        <div className="flex items-center gap-3 mb-4">
            <BanknotesIcon className="w-6 h-6 text-emerald-400" />
            <h2 className="text-2xl font-bold">Resumen Total</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-slate-900/40 rounded-lg p-4 border border-white/5">
            <div className="text-sm text-slate-400 mb-1">Total Semanal (A+B)</div>
            <div className="text-3xl font-bold font-mono text-white">{formatear(totals.semanalA + totals.semanalB)}</div>
          </div>
          <div className="bg-slate-900/40 rounded-lg p-4 border border-white/5">
            <div className="text-sm text-slate-400 mb-1">Total Mensual (A+B)</div>
            <div className="text-3xl font-bold font-mono text-emerald-400">{formatear(totals.mensualA + totals.mensualB)}</div>
          </div>
        </div>
      </div>

      {/* Tables */}
      {renderTable('A', 'Gastos Categoría A', 'text-indigo-300', 'border-indigo-500/20')}
      {renderTable('B', 'Gastos Categoría B', 'text-emerald-300', 'border-emerald-500/20')}

      {/* Add New Form */}
      <div className="bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-700">
        <h2 className="text-xl font-bold text-slate-200 mb-4 flex items-center gap-2">
            <PlusIcon className="w-5 h-5" /> Agregar Nuevo Gasto
        </h2>
        <div className="grid md:grid-cols-12 gap-3">
          <div className="md:col-span-3">
             <input
                placeholder="Nombre del gasto"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm focus:outline-none focus:border-primary-500"
            />
          </div>
          
          <div className="md:col-span-2">
             <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as 'A' | 'B')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm focus:outline-none focus:border-primary-500"
            >
                <option value="A">Categoría A</option>
                <option value="B">Categoría B</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
                value={newFrequency}
                onChange={(e) => setNewFrequency(e.target.value as 'weekly' | 'monthly')}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm focus:outline-none focus:border-primary-500"
            >
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
            </select>
          </div>

           <div className="md:col-span-3 relative">
            <span className="absolute left-3 top-2 text-slate-500">$</span>
             <input
                type="number"
                placeholder="Valor"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="w-full pl-6 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-sm focus:outline-none focus:border-primary-500"
            />
          </div>

          <div className="md:col-span-2">
            <button
                onClick={handleAdd}
                className="w-full bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary-900/20"
            >
                Agregar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
