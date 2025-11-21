
import React, { useState } from 'react';
import { ViewMode, Priority } from '../types';
import { ListBulletIcon, BrainIcon, PillIcon, BanknotesIcon, ChevronLeftIcon, ChevronRightIcon, FlagIcon, CalendarIcon } from './Icons';

interface SidebarProps {
  currentView: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  currentPriorityFilter: Priority | 'ALL';
  setPriorityFilter: (p: Priority | 'ALL') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, setViewMode, currentPriorityFilter, setPriorityFilter }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Styles for Priorities
  const getPriorityColor = (p: Priority) => {
      switch(p) {
          case 'P1': return 'text-red-500';
          case 'P2': return 'text-orange-400';
          case 'P3': return 'text-blue-400';
          default: return 'text-slate-500';
      }
  };

  const menuItems = [
    {
      id: ViewMode.LIST,
      label: 'My Tasks',
      icon: ListBulletIcon,
      subItems: [
          { id: 'ALL', label: 'All Tasks', color: 'text-slate-400' },
          { id: 'P1', label: 'High Priority', color: 'text-red-500' },
          { id: 'P2', label: 'Medium Priority', color: 'text-orange-400' },
          { id: 'P3', label: 'Low Priority', color: 'text-blue-400' },
      ]
    },
    {
        id: ViewMode.CALENDAR,
        label: 'Calendar',
        icon: CalendarIcon,
    },
    {
      id: ViewMode.BRAINSTORM,
      label: 'AI Planner',
      icon: BrainIcon,
    },
    {
      id: ViewMode.MEDICINES,
      label: 'Medicines',
      icon: PillIcon,
    },
    {
      id: ViewMode.EXPENSES,
      label: 'Expenses',
      icon: BanknotesIcon,
    },
  ];

  return (
    <div 
      className={`
        relative bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 h-screen transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-20' : 'w-72'}
      `}
    >
      {/* Toggle Button */}
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-8 bg-slate-800 border border-slate-700 text-slate-400 hover:text-white p-1 rounded-full shadow-lg z-10"
      >
        {isCollapsed ? <ChevronRightIcon className="w-4 h-4" /> : <ChevronLeftIcon className="w-4 h-4" />}
      </button>

      {/* Header */}
      <div className={`p-6 border-b border-slate-800 ${isCollapsed ? 'flex justify-center' : ''}`}>
        {isCollapsed ? (
           <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-lg">
             TM
           </div>
        ) : (
          <div>
             <h1 className="text-xl font-bold bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent whitespace-nowrap">
              Task Master
            </h1>
            <p className="text-xs text-slate-500 mt-1">Voice & AI Assistant</p>
          </div>
        )}
      </div>

      {/* Menu */}
      <nav className="flex-1 py-6 px-3 space-y-2">
        {menuItems.map((item) => {
          const isActive = currentView === item.id;
          const hasSubItems = item.id === ViewMode.LIST && !isCollapsed && isActive;

          return (
            <div key={item.id}>
                <button
                onClick={() => setViewMode(item.id)}
                title={isCollapsed ? item.label : ''}
                className={`
                    w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-200
                    ${isActive 
                    ? 'bg-primary-600/10 text-primary-400 border border-primary-500/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                `}
                >
                <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary-400' : 'text-slate-500'}`} />
                {!isCollapsed && (
                    <span className="truncate">{item.label}</span>
                )}
                </button>

                {/* Sub Items for My Tasks */}
                {hasSubItems && item.subItems && (
                    <div className="mt-2 ml-4 space-y-1 pl-4 border-l border-slate-800">
                        {item.subItems.map((sub) => (
                            <button
                                key={sub.id}
                                onClick={() => setPriorityFilter(sub.id as Priority | 'ALL')}
                                className={`
                                    w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors
                                    ${currentPriorityFilter === sub.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}
                                `}
                            >
                                <FlagIcon className={`w-3 h-3 ${sub.color}`} />
                                {sub.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
          );
        })}
      </nav>

      {/* User / Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50">
         <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-inner border border-slate-700">
                U
            </div>
            {!isCollapsed && (
              <div className="overflow-hidden">
                  <p className="text-sm font-medium text-slate-200 truncate">User</p>
                  <p className="text-xs text-slate-500 truncate">Free Plan</p>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};
