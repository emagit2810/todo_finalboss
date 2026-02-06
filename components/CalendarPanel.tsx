
import React, { useMemo, useState } from 'react';
import { Todo, Priority, Medicine } from '../types';
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon } from './Icons';
import { buildMedicineAlerts, getDateKeyFromTimestamp, groupMedicineAlertsByDate } from '../utils/medicineAlerts';

interface CalendarPanelProps {
  todos: Todo[];
  medicines: Medicine[];
  onUpdateTodo: (todo: Todo) => void;
  onAddTodo: (text: string, priority: Priority, date: number) => void;
  onOpenReminder?: () => void;
  onOpenMedicines?: () => void;
  onOpenExpenses?: () => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIORITY_WEIGHT: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

export const CalendarPanel: React.FC<CalendarPanelProps> = ({
  todos,
  medicines,
  onUpdateTodo,
  onAddTodo,
  onOpenReminder,
  onOpenMedicines,
  onOpenExpenses,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<Priority>('P2');

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
    switch (p) {
      case 'P1':
        return 'bg-red-500';
      case 'P2':
        return 'bg-orange-400';
      case 'P3':
        return 'bg-blue-400';
      default:
        return 'bg-slate-600';
    }
  };

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getDate() === d2.getDate() && d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();

  const todayStart = (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  })();

  const medicineAlertsByDate = useMemo(() => {
    const alerts = buildMedicineAlerts(medicines, todayStart);
    return groupMedicineAlertsByDate(alerts);
  }, [medicines, todayStart]);

  const sortTasksByRules = (tasks: Todo[]) => {
    return [...tasks].sort((a, b) => {
      const wa = PRIORITY_WEIGHT[a.priority] ?? 99;
      const wb = PRIORITY_WEIGHT[b.priority] ?? 99;
      if (wa !== wb) return wa - wb;
      if (wa === 1 && wb === 1) {
        return (a.createdAt || 0) - (b.createdAt || 0); // P1 ties: creation date wins
      }
      const createdDiff = (a.createdAt || 0) - (b.createdAt || 0);
      if (createdDiff !== 0) return createdDiff;
      return a.text.localeCompare(b.text);
    });
  };

  const getTasksForDate = (date: Date) => {
    return todos.filter((t) => {
      if (!t.dueDate) return false;
      const tDate = new Date(t.dueDate);
      return isSameDay(tDate, date);
    });
  };

  const getTasksForDay = (day: number) => getTasksForDate(new Date(year, month, day));

  const buildDaySummary = (tasks: Todo[]) => {
    if (!tasks.length) return null;
    const ordered = sortTasksByRules(tasks);
    const primary = ordered[0];
    const extraCount = tasks.length - 1;
    const label =
      extraCount > 0
        ? `${primary.text} +${extraCount} tarea${extraCount > 1 ? 's' : ''}`
        : primary.text;
    return { primary, extraCount, label };
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !newTaskText.trim()) return;

    const due = new Date(selectedDate);
    due.setHours(12, 0, 0, 0); // avoid timezone rollover

    onAddTodo(newTaskText.trim(), newTaskPriority, due.getTime());
    setNewTaskText('');
    setNewTaskPriority('P2');
  };

  const handleToggleTask = (task: Todo) => {
    onUpdateTodo({ ...task, completed: !task.completed });
  };

  const renderCells = () => {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className="h-[120px] bg-slate-900/30 border border-slate-800/50 opacity-50" />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month, day);
      const isToday = isSameDay(new Date(), dateObj);
      const tasks = getTasksForDay(day);
      const summary = buildDaySummary(tasks);
      const alertKey = getDateKeyFromTimestamp(dateObj.getTime());
      const medAlerts = medicineAlertsByDate.get(alertKey) || [];
      const medSummary = medAlerts.length === 1 ? medAlerts[0].label : medAlerts.length > 1 ? `${medAlerts.length} med alerts` : null;

      cells.push(
        <div
          key={day}
          onClick={() => setSelectedDate(dateObj)}
          className={`h-[120px] p-2 border border-slate-800 bg-slate-900/80 hover:bg-slate-800 transition-colors cursor-pointer relative group overflow-hidden
                ${isToday ? 'ring-1 ring-inset ring-primary-500 bg-primary-900/10' : ''}`}
        >
          <div className="flex justify-between items-start mb-1">
            <span
              className={`text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full
                ${isToday ? 'bg-primary-600 text-white' : 'text-slate-400'}`}
            >
              {day}
            </span>
            <span className="opacity-0 group-hover:opacity-100 text-xs text-slate-500">+</span>
          </div>

          {summary && (
            <div
              className="mt-auto bg-slate-800/80 text-[11px] px-2 py-2 rounded-lg flex items-center gap-2 border border-slate-700/70 truncate"
              title={summary.label}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getPriorityColorBg(summary.primary.priority)}`} />
              <span className="truncate text-slate-100">{summary.label}</span>
            </div>
          )}

          {medSummary && (
            <div
              className="mt-1 bg-amber-500/10 text-[10px] px-2 py-1 rounded-lg border border-amber-500/20 text-amber-200 truncate"
              title={medSummary}
            >
              {medSummary}
            </div>
          )}
        </div>
      );
    }
    return cells;
  };

  const selectedDateTasks = useMemo(
    () => (selectedDate ? sortTasksByRules(getTasksForDate(selectedDate)) : []),
    [selectedDate, todos, year, month]
  );
  const selectedDateAlerts = selectedDate ? medicineAlertsByDate.get(getDateKeyFromTimestamp(selectedDate.getTime())) || [] : [];

  return (
    <div className="h-full flex flex-col pb-20 max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold text-white mb-1">
            {currentDate.toLocaleString('default', { month: 'long' })} {year}
          </h2>
          <p className="text-slate-400 text-sm">Plan your schedule</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white">
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <button
            onClick={resetToday}
            className="px-3 py-1 rounded border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            Today
          </button>
          <button onClick={nextMonth} className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white">
            <ChevronRightIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px mb-px">
        {DAYS.map((day) => (
          <div key={day} className="text-center py-2 text-sm font-semibold text-slate-500 uppercase tracking-wider">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr gap-px bg-slate-800 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
        {renderCells()}
      </div>

      {selectedDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedDate(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-[90vw] md:w-[70vw] lg:w-[45vw] min-h-[40vh] max-h-[80vh] shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Tareas del</p>
                <h3 className="text-xl font-bold text-white">
                  {selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">Prioridad 1 siempre visible; empates por fecha de creacion.</p>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg px-3 py-1"
              >
                Cerrar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={() => {
                  onOpenReminder?.();
                  setSelectedDate(null);
                }}
                className="bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 border border-indigo-500/30 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Recordatorio
              </button>
              <button
                onClick={() => {
                  onOpenMedicines?.();
                  setSelectedDate(null);
                }}
                className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-200 border border-blue-500/30 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                Tracker de medicinas
              </button>
              <button
                onClick={() => {
                  onOpenExpenses?.();
                  setSelectedDate(null);
                }}
                className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/30 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                3 gastos importantes
              </button>
            </div>

            <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="max-h-[35vh] overflow-y-auto divide-y divide-slate-800">
                {selectedDateAlerts.length > 0 && (
                  <div className="p-4 bg-amber-500/5">
                    <p className="text-[10px] uppercase tracking-wider text-amber-300 mb-2">Medicines</p>
                    <div className="space-y-2">
                      {selectedDateAlerts.map((alert) => (
                        <div key={alert.id} className="flex items-center justify-between text-sm">
                          <span className="text-amber-100">{alert.label}</span>
                          <span className="text-[10px] text-amber-300">{alert.kind === 'refill-end' ? 'Ends' : 'Refill soon'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedDateTasks.length === 0 && selectedDateAlerts.length === 0 && (
                  <div className="p-4 text-sm text-slate-500">Aun no hay tareas en este dia.</div>
                )}
                {selectedDateTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-3 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => handleToggleTask(task)}
                        className={`w-5 h-5 flex items-center justify-center rounded border ${
                          task.completed
                            ? 'bg-primary-600 border-primary-500 text-white'
                            : 'border-slate-600 text-slate-400 hover:border-primary-400'
                        }`}
                        title="Marcar completada"
                      >
                        {task.completed && <CheckIcon className="w-3 h-3" />}
                      </button>
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${task.completed ? 'line-through text-slate-500' : 'text-slate-100'}`}>
                          {task.text}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Prioridad {task.priority} - Creada {new Date(task.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getPriorityColorBg(task.priority)}`} />
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddTask} className="space-y-3">
              <input
                autoFocus
                type="text"
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                placeholder="Nueva tarea para este dia..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary-500"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 bg-slate-900/60 rounded-lg px-2 py-1">
                  {(['P1', 'P2', 'P3', 'P4'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewTaskPriority(p)}
                      className={`px-2 py-1 rounded text-xs font-semibold transition-colors
                        ${
                          newTaskPriority === p
                            ? p === 'P1'
                              ? 'bg-red-500/20 text-red-300'
                              : p === 'P2'
                              ? 'bg-orange-500/20 text-orange-200'
                              : p === 'P3'
                              ? 'bg-blue-500/20 text-blue-200'
                              : 'bg-slate-700/60 text-slate-200'
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDate(null)}
                    className="px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white font-medium disabled:opacity-50"
                    disabled={!newTaskText.trim()}
                  >
                    Anadir tarea
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
