
import React, { useMemo, useState } from 'react';
import { ViewMode, Priority, NoteDoc, NoteFolder } from '../types';
import { ListBulletIcon, BrainIcon, PillIcon, BanknotesIcon, ChevronLeftIcon, ChevronRightIcon, FlagIcon, CalendarIcon, DocumentIcon, ChevronDownIcon, FolderIcon } from './Icons';

interface SidebarProps {
  currentView: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  currentPriorityFilter: Priority | 'ALL';
  setPriorityFilter: (p: Priority | 'ALL') => void;
  noteFolders?: NoteFolder[];
  notes?: NoteDoc[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setViewMode,
  currentPriorityFilter,
  setPriorityFilter,
  noteFolders = [],
  notes = [],
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [notesTreeExpanded, setNotesTreeExpanded] = useState(true);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);

  // Styles for Priorities
  const getPriorityColor = (p: Priority) => {
      switch(p) {
          case 'P1': return 'text-red-500';
          case 'P2': return 'text-orange-400';
          case 'P3': return 'text-blue-400';
          default: return 'text-slate-500';
      }
  };

  const folderChildren = useMemo(() => {
    const map = new Map<string | null, NoteFolder[]>();
    noteFolders.forEach((folder) => {
      const key = folder.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(folder);
    });
    map.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return map;
  }, [noteFolders]);

  const notesByFolder = useMemo(() => {
    const map = new Map<string | null, NoteDoc[]>();
    notes.forEach((note) => {
      const key = note.folderId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(note);
    });
    map.forEach((list) => list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    return map;
  }, [notes]);

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
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
    {
      id: ViewMode.NOTES,
      label: 'Notas',
      icon: DocumentIcon,
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
          const showNotesTree = item.id === ViewMode.NOTES && !isCollapsed && isActive;

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

                {showNotesTree && (
                  <div className="mt-2 ml-4 space-y-2 pl-4 border-l border-slate-800">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Notas</span>
                      <button
                        onClick={() => setNotesTreeExpanded((prev) => !prev)}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400"
                        title={notesTreeExpanded ? 'Ocultar' : 'Mostrar'}
                      >
                        {notesTreeExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                      </button>
                    </div>
                    {notesTreeExpanded && (
                      <div className="space-y-1">
                        {(folderChildren.get(null) || []).map((folder) => {
                          const renderFolder = (node: NoteFolder, depth: number) => {
                            const childFolders = folderChildren.get(node.id) || [];
                            const childNotes = notesByFolder.get(node.id) || [];
                            const hasChildren = childFolders.length + childNotes.length > 0;
                            const isExpanded = expandedFolderIds.includes(node.id);
                            return (
                              <div key={node.id}>
                                <div className="flex items-center" style={{ paddingLeft: 6 + depth * 10 }}>
                                  {hasChildren ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleFolderExpanded(node.id);
                                      }}
                                      className="p-1 rounded hover:bg-slate-800 text-slate-400"
                                      title={isExpanded ? 'Ocultar' : 'Mostrar'}
                                    >
                                      {isExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
                                    </button>
                                  ) : (
                                    <span className="w-5" />
                                  )}
                                  <button
                                    onClick={() => setViewMode(ViewMode.NOTES)}
                                    className="flex-1 flex items-center gap-2 px-2 py-1 rounded-md text-xs text-slate-400 hover:bg-slate-800"
                                  >
                                    <FolderIcon className="w-3.5 h-3.5" />
                                    <span className="truncate">{node.name}</span>
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="mt-1 space-y-1">
                                    {childFolders.map((child) => renderFolder(child, depth + 1))}
                                    {childNotes.map((note) => (
                                      <button
                                        key={note.id}
                                        onClick={() => setViewMode(ViewMode.NOTES)}
                                        className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:bg-slate-800"
                                        style={{ paddingLeft: 18 + (depth + 1) * 10 }}
                                      >
                                        <DocumentIcon className="w-3 h-3" />
                                        <span className="truncate">{note.title || 'Untitled'}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          };
                          return renderFolder(folder, 0);
                        })}
                        {(folderChildren.get(null) || []).length === 0 && (
                          <p className="text-[11px] text-slate-600">Sin carpetas.</p>
                        )}
                        {(notesByFolder.get(null) || []).map((note) => (
                          <button
                            key={note.id}
                            onClick={() => setViewMode(ViewMode.NOTES)}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:bg-slate-800"
                          >
                            <DocumentIcon className="w-3 h-3" />
                            <span className="truncate">{note.title || 'Untitled'}</span>
                          </button>
                        ))}
                      </div>
                    )}
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
