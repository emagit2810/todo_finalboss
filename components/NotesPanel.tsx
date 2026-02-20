import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NoteDoc, NoteFolder, Todo, Priority } from '../types';
import { DocumentIcon, FolderIcon, PlusIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, ArrowsCollapseIcon, ArrowsExpandIcon, XMarkIcon } from './Icons';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { deriveKeyAndHash, decryptWithKey, encryptWithKey, generateSalt } from '../utils/crypto';

interface NotesPanelProps {
  notes: NoteDoc[];
  folders: NoteFolder[];
  onAddNote: (note: NoteDoc) => void;
  onUpdateNote: (note: NoteDoc) => void;
  onDeleteNote: (id: string) => void;
  onAddFolder: (folder: NoteFolder) => void;
  onUpdateFolder: (folder: NoteFolder) => void;
  onDeleteFolder: (id: string) => void;
  openNoteId?: string | null;
  onConsumeOpenNoteId?: () => void;
  todos?: Todo[];
  onUpdateTodo?: (todo: Todo) => void;
}

const PASSWORD_ITERATIONS = 100000;
const PRESET_TAGS = [
  'prompt estudio',
  'prompt problema',
  'prompt idea',
  'ideas',
  'clave',
  'tema estudiar',
];

const normalizeTags = (value: string) => {
  const tags = value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return Array.from(new Set(tags.map((t) => t.toLowerCase())));
};

const NotePanelEmptyState = () => (
  <div className="flex flex-col items-center justify-center h-full text-slate-500">
    <p className="text-sm">Selecciona o crea un documento.</p>
  </div>
);

export const NotesPanel: React.FC<NotesPanelProps> = ({
  notes,
  folders,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onAddFolder,
  onUpdateFolder,
  onDeleteFolder,
  openNoteId,
  onConsumeOpenNoteId,
  todos = [],
  onUpdateTodo,
}) => {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [notesTreeExpanded, setNotesTreeExpanded] = useState(true);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [isEditorWide, setIsEditorWide] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);

  const [newFolderName, setNewFolderName] = useState('');
  const [newNoteTitle, setNewNoteTitle] = useState('');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftTags, setDraftTags] = useState('');

  const [noteLockPassword, setNoteLockPassword] = useState('');
  const [noteLockConfirm, setNoteLockConfirm] = useState('');
  const [noteUnlockPassword, setNoteUnlockPassword] = useState('');

  const [folderPassword, setFolderPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  // States for task linking
  const [isTaskLinkerOpen, setIsTaskLinkerOpen] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<Priority | 'all'>('all');
  const [taskQuery, setTaskQuery] = useState('');
  const [linkTaskOnCreate, setLinkTaskOnCreate] = useState(false);
  
  const cryptoReady = typeof crypto !== 'undefined' && !!crypto.subtle;

  const noteKeysRef = useRef<Map<string, CryptoKey>>(new Map());
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<string[]>([]);
  const [unlockedFolderIds, setUnlockedFolderIds] = useState<string[]>([]);

  const folderMap = useMemo(() => {
    const map = new Map<string, NoteFolder>();
    folders.forEach((f) => map.set(f.id, f));
    return map;
  }, [folders]);

  const activeFolder = activeFolderId ? folderMap.get(activeFolderId) || null : null;
  const isFolderLocked = !!(activeFolder?.locked && !unlockedFolderIds.includes(activeFolder.id));

  const folderChildren = useMemo(() => {
    const map = new Map<string | null, NoteFolder[]>();
    folders.forEach((folder) => {
      const key = folder.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(folder);
    });
    map.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
    return map;
  }, [folders]);

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

  const draftTagList = useMemo(() => normalizeTags(draftTags), [draftTags]);

  // Memoized filtered todos for task linking
  const filteredTodos = useMemo(() => {
    let list = todos.filter(todo => !todo.completed);
    
    // Filter by priority
    if (selectedPriority !== 'all') {
      list = list.filter(todo => todo.priority === selectedPriority);
    }
    
    // Filter by search query
    if (taskQuery.trim()) {
      const query = taskQuery.toLowerCase();
      list = list.filter(todo => 
        todo.text.toLowerCase().includes(query) ||
        todo.description?.toLowerCase().includes(query)
      );
    }
    
    // Sort by priority first, then by creation date
    return list.sort((a, b) => {
      const priorityOrder = { 'P1': 0, 'P2': 1, 'P3': 2, 'P4': 3 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      return a.createdAt - b.createdAt;
    });
  }, [todos, selectedPriority, taskQuery]);

  // Get task number for display
  const getTaskNumber = (todo: Todo, allTodos: Todo[]) => {
    const priorityOrder = { 'P1': 0, 'P2': 1, 'P3': 2, 'P4': 3 };
    const sortedTodos = allTodos
      .filter(t => !t.completed)
      .sort((a, b) => {
        const aPriority = priorityOrder[a.priority];
        const bPriority = priorityOrder[b.priority];
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.createdAt - b.createdAt;
      });
    
    return sortedTodos.findIndex(t => t.id === todo.id) + 1;
  };

  const linkTaskToNote = (todoId: string) => {
    if (!activeNoteId || !onUpdateTodo) return;
    
    const todo = todos.find(t => t.id === todoId);
    if (!todo) return;
    
    const currentLinkedNotes = new Set(todo.linkedNotes || []);
    currentLinkedNotes.add(activeNoteId);
    
    onUpdateTodo({
      ...todo,
      linkedNotes: Array.from(currentLinkedNotes)
    });
    
    setIsTaskLinkerOpen(false);
    setTaskQuery('');
  };

  const searchText = searchQuery.trim().toLowerCase();
  const tagFilters = useMemo(() => normalizeTags(tagQuery), [tagQuery]);
  const isFilterActive = searchText.length > 0 || tagFilters.length > 0;

  const noteMatches = useCallback((note: NoteDoc) => {
    const haystack = `${note.title} ${(note.content || '')} ${(note.tags || []).join(' ')}`.toLowerCase();
    const textMatch = searchText ? haystack.includes(searchText) : false;
    const noteTags = (note.tags || []).map((t) => t.toLowerCase());
    const tagMatch = tagFilters.length > 0 ? tagFilters.some((t) => noteTags.includes(t)) : false;
    if (searchText && tagFilters.length > 0) return textMatch || tagMatch;
    if (searchText) return textMatch;
    if (tagFilters.length > 0) return tagMatch;
    return true;
  }, [searchText, tagFilters]);

  const folderMatches = useCallback((folder: NoteFolder) => {
    const name = folder.name.toLowerCase();
    const textMatch = searchText ? name.includes(searchText) : false;
    const tagMatch = tagFilters.length > 0 ? tagFilters.some((t) => name.includes(t)) : false;
    if (searchText && tagFilters.length > 0) return textMatch || tagMatch;
    if (searchText) return textMatch;
    if (tagFilters.length > 0) return tagMatch;
    return true;
  }, [searchText, tagFilters]);

  const filteredNotes = useMemo(() => {
    let list = notes;
    if (!isFilterActive && activeFolderId) {
      list = list.filter((n) => n.folderId === activeFolderId);
    }
    if (isFilterActive) {
      list = list.filter(noteMatches);
      return list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [notes, activeFolderId, isFilterActive, noteMatches]);

  const filteredTreeNotes = useMemo(() => {
    if (!isFilterActive) return [];
    return notes
      .filter(noteMatches)
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }, [notes, isFilterActive, noteMatches]);

  const filteredTreeFolders = useMemo(() => {
    if (!isFilterActive) return [];
    return folders
      .filter(folderMatches)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, isFilterActive, folderMatches]);

  const activeNote = activeNoteId ? notes.find((n) => n.id === activeNoteId) || null : null;
  const isNoteLocked = !!(activeNote?.locked && !unlockedNoteIds.includes(activeNote.id));

  useEffect(() => {
    if (!activeNoteId || isNoteLocked) return;
    const frameId = window.requestAnimationFrame(() => {
      editorTextareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeNoteId, isNoteLocked]);

  const loadNoteToDraft = async (note: NoteDoc | null) => {
    setLocalError(null);
    setNoteLockPassword('');
    setNoteLockConfirm('');
    setNoteUnlockPassword('');
    if (!note) {
      setDraftTitle('');
      setDraftContent('');
      setDraftTags('');
      return;
    }
    setDraftTitle(note.title || '');
    setDraftTags((note.tags || []).join(', '));
    if (note.locked) {
      setDraftContent('');
    } else {
      setDraftContent(note.content || '');
    }
  };

  useEffect(() => {
    if (activeNoteId && !notes.find((n) => n.id === activeNoteId)) {
      setActiveNoteId(null);
    }
  }, [notes, activeNoteId]);

  useEffect(() => {
    if (!activeFolderId || !activeNoteId) return;
    const current = notes.find((n) => n.id === activeNoteId);
    if (current && current.folderId !== activeFolderId) {
      setActiveNoteId(null);
    }
  }, [activeFolderId, activeNoteId, notes]);

  useEffect(() => {
    void loadNoteToDraft(activeNote);
  }, [activeNoteId]);

  useEffect(() => {
    if (!openNoteId) return;
    const requestedNoteId = openNoteId;
    onConsumeOpenNoteId?.();
    const targetNote = notes.find((n) => n.id === requestedNoteId) || null;

    const openRequestedNote = async () => {
      if (!targetNote) {
        setLocalError('Documento no encontrado.');
        return;
      }

      const targetFolderId = targetNote.folderId ?? null;
      if (targetFolderId) {
        const folder = folderMap.get(targetFolderId);
        const locked = !!(folder && folder.locked && !unlockedFolderIds.includes(folder.id));
        setActiveFolderId(targetFolderId);
        setNotesTreeExpanded(true);

        if (locked) {
          setActiveNoteId(null);
          setLocalError('Desbloquea la carpeta para abrir este documento.');
          return;
        }

        const chain: string[] = [];
        let current: string | null = targetFolderId;
        while (current) {
          chain.push(current);
          const currentFolder = folderMap.get(current);
          current = currentFolder?.parentId ?? null;
        }
        setExpandedFolderIds((prev) => {
          const next = new Set(prev);
          chain.forEach((id) => next.add(id));
          return Array.from(next);
        });
      } else {
        setActiveFolderId(null);
        setNotesTreeExpanded(true);
      }

      setActiveNoteId(targetNote.id);
    };

    void openRequestedNote();
  }, [openNoteId, notes, folderMap, unlockedFolderIds, onConsumeOpenNoteId]);

  const persistDraft = async () => {
    if (!activeNote) return;
    if (isNoteLocked) return;
    setSaving(true);
    try {
      const tags = normalizeTags(draftTags);
      const baseUpdate: NoteDoc = {
        ...activeNote,
        title: draftTitle.trim() || 'Untitled',
        tags,
        updatedAt: Date.now(),
      };

      if (activeNote.locked) {
        const key = noteKeysRef.current.get(activeNote.id);
        if (!key) {
          setLocalError('No se encontro clave para cifrar.');
          return;
        }
        const { cipherText, iv } = await encryptWithKey(draftContent, key);
        const lockedUpdate: NoteDoc = {
          ...baseUpdate,
          locked: true,
          encryptedContent: cipherText,
          iv,
          content: undefined,
        };
        await onUpdateNote(lockedUpdate);
      } else {
        const unlockedUpdate: NoteDoc = {
          ...baseUpdate,
          content: draftContent,
          encryptedContent: undefined,
          iv: undefined,
          salt: undefined,
          lockHash: undefined,
          lockIterations: undefined,
          locked: false,
        };
        await onUpdateNote(unlockedUpdate);
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (!isSaveShortcut) return;
      event.preventDefault();
      if (!activeNote || isNoteLocked) return;
      void persistDraft();
    };

    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [activeNote, isNoteLocked, persistDraft]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const now = Date.now();
    const folder: NoteFolder = {
      id: crypto.randomUUID(),
      name,
      parentId: activeFolderId,
      createdAt: now,
      updatedAt: now,
      locked: false,
    };
    await onAddFolder(folder);
    if (folder.parentId) {
      setExpandedFolderIds((prev) => (prev.includes(folder.parentId!) ? prev : [...prev, folder.parentId!]));
    }
    setExpandedFolderIds((prev) => (prev.includes(folder.id) ? prev : [...prev, folder.id]));
    setNotesTreeExpanded(true);
    setNewFolderName('');
    setActiveFolderId(folder.id);
  };

  const handleCreateNote = async () => {
    if (isFolderLocked) {
      setLocalError('Desbloquea la carpeta antes de crear documentos.');
      return;
    }
    const title = newNoteTitle.trim() || 'Untitled';
    const now = Date.now();
    const note: NoteDoc = {
      id: crypto.randomUUID(),
      title,
      content: '',
      folderId: activeFolderId,
      tags: [],
      createdAt: now,
      updatedAt: now,
      locked: false,
    };
    await onAddNote(note);
    if (note.folderId) {
      setExpandedFolderIds((prev) => (prev.includes(note.folderId!) ? prev : [...prev, note.folderId!]));
    }
    setNotesTreeExpanded(true);
    setNewNoteTitle('');
    setActiveNoteId(note.id);
    await loadNoteToDraft(note);
    
    // If link task mode is active, open the task linker
    if (linkTaskOnCreate) {
      setLinkTaskOnCreate(false);
      setIsTaskLinkerOpen(true);
    }
  };

  const handleDeleteCurrentNote = async () => {
    if (!activeNote) return;
    await onDeleteNote(activeNote.id);
    noteKeysRef.current.delete(activeNote.id);
    setUnlockedNoteIds((prev) => prev.filter((id) => id !== activeNote.id));
    setActiveNoteId(null);
    setDraftContent('');
    setDraftTitle('');
    setDraftTags('');
  };

  const handleLockNote = async () => {
    if (!activeNote) return;
    if (!cryptoReady) {
      setLocalError('Cifrado no disponible en este navegador.');
      return;
    }
    if (!noteLockPassword || noteLockPassword !== noteLockConfirm) {
      setLocalError('La contrasena no coincide.');
      return;
    }
    const salt = generateSalt();
    const { key, hash, iterations } = await deriveKeyAndHash(noteLockPassword, salt, PASSWORD_ITERATIONS);
    const { cipherText, iv } = await encryptWithKey(draftContent, key);
    const lockedUpdate: NoteDoc = {
      ...activeNote,
      title: draftTitle.trim() || 'Untitled',
      tags: normalizeTags(draftTags),
      locked: true,
      encryptedContent: cipherText,
      iv,
      salt,
      lockHash: hash,
      lockIterations: iterations,
      content: undefined,
      updatedAt: Date.now(),
    };
    await onUpdateNote(lockedUpdate);
    noteKeysRef.current.delete(activeNote.id);
    setUnlockedNoteIds((prev) => prev.filter((id) => id !== activeNote.id));
    setNoteLockPassword('');
    setNoteLockConfirm('');
    setDraftContent('');
  };

  const handleUnlockNote = async () => {
    if (!activeNote || !activeNote.locked) return;
    if (!cryptoReady) {
      setLocalError('Cifrado no disponible en este navegador.');
      return;
    }
    if (!noteUnlockPassword) {
      setLocalError('Ingresa la contrasena.');
      return;
    }
    if (!activeNote.salt || !activeNote.lockHash || !activeNote.encryptedContent || !activeNote.iv) {
      setLocalError('No se pudo desbloquear este documento.');
      return;
    }
    const { key, hash } = await deriveKeyAndHash(
      noteUnlockPassword,
      activeNote.salt,
      activeNote.lockIterations || PASSWORD_ITERATIONS
    );
    if (hash !== activeNote.lockHash) {
      setLocalError('Contrasena incorrecta.');
      return;
    }
    const plain = await decryptWithKey(activeNote.encryptedContent, activeNote.iv, key);
    noteKeysRef.current.set(activeNote.id, key);
    setUnlockedNoteIds((prev) => (prev.includes(activeNote.id) ? prev : [...prev, activeNote.id]));
    setDraftContent(plain);
    setNoteUnlockPassword('');
  };

  const handleRemoveNoteLock = async () => {
    if (!activeNote) return;
    if (!cryptoReady) {
      setLocalError('Cifrado no disponible en este navegador.');
      return;
    }
    if (!noteUnlockPassword) {
      setLocalError('Ingresa la contrasena actual.');
      return;
    }
    if (!activeNote.salt || !activeNote.lockHash) {
      setLocalError('No se pudo validar la contrasena.');
      return;
    }
    const { key, hash } = await deriveKeyAndHash(
      noteUnlockPassword,
      activeNote.salt,
      activeNote.lockIterations || PASSWORD_ITERATIONS
    );
    if (activeNote.lockHash && hash !== activeNote.lockHash) {
      setLocalError('Contrasena incorrecta.');
      return;
    }
    const plain = activeNote.encryptedContent && activeNote.iv
      ? await decryptWithKey(activeNote.encryptedContent, activeNote.iv, key)
      : draftContent;
    const unlockedUpdate: NoteDoc = {
      ...activeNote,
      title: draftTitle.trim() || 'Untitled',
      tags: normalizeTags(draftTags),
      locked: false,
      content: plain,
      encryptedContent: undefined,
      iv: undefined,
      salt: undefined,
      lockHash: undefined,
      lockIterations: undefined,
      updatedAt: Date.now(),
    };
    await onUpdateNote(unlockedUpdate);
    noteKeysRef.current.delete(activeNote.id);
    setUnlockedNoteIds((prev) => prev.filter((id) => id !== activeNote.id));
    setNoteUnlockPassword('');
  };

  const handleExportToPDF = async () => {
    if (!activeNote) return;
    if (isNoteLocked) {
      setLocalError('Desbloquea el documento para exportar.');
      return;
    }
    if (!draftContent.trim()) {
      setLocalError('El documento esta vacio.');
      return;
    }
    setLocalError(null);
    const tempDiv = document.createElement('div');
    tempDiv.style.padding = '20px';
    tempDiv.style.fontFamily = 'Arial, sans-serif';
    tempDiv.style.fontSize = '12px';
    tempDiv.style.whiteSpace = 'pre-wrap';
    tempDiv.style.color = '#0f172a';
    tempDiv.style.width = '794px';
    tempDiv.textContent = draftContent;
    document.body.appendChild(tempDiv);
    try {
      const canvas = await html2canvas(tempDiv);
      const imgData = canvas.toDataURL('image/png');

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const pageHeight = 295;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const safeTitle = (activeNote.title || 'documento').replace(/[\\/:*?"<>|]+/g, '-');
      pdf.save(`${safeTitle}.pdf`);
    } finally {
      document.body.removeChild(tempDiv);
    }
  };

  const handleLockFolder = async () => {
    if (!activeFolder) return;
    if (!cryptoReady) {
      setLocalError('Cifrado no disponible en este navegador.');
      return;
    }
    if (!folderPassword) {
      setLocalError('Ingresa una contrasena para la carpeta.');
      return;
    }
    const salt = generateSalt();
    const { hash, iterations } = await deriveKeyAndHash(folderPassword, salt, PASSWORD_ITERATIONS);
    const updated: NoteFolder = {
      ...activeFolder,
      locked: true,
      lockSalt: salt,
      lockHash: hash,
      lockIterations: iterations,
      updatedAt: Date.now(),
    };
    await onUpdateFolder(updated);
    setFolderPassword('');
    setUnlockedFolderIds((prev) => prev.filter((id) => id !== activeFolder.id));
  };

  const handleUnlockFolder = async (removeLock: boolean) => {
    if (!activeFolder || !activeFolder.locked) return;
    if (!cryptoReady) {
      setLocalError('Cifrado no disponible en este navegador.');
      return;
    }
    if (!folderPassword) {
      setLocalError('Ingresa la contrasena de la carpeta.');
      return;
    }
    if (!activeFolder.lockSalt || !activeFolder.lockHash) {
      setLocalError('No se puede desbloquear esta carpeta.');
      return;
    }
    const { hash } = await deriveKeyAndHash(
      folderPassword,
      activeFolder.lockSalt,
      activeFolder.lockIterations || PASSWORD_ITERATIONS
    );
    if (hash !== activeFolder.lockHash) {
      setLocalError('Contrasena incorrecta.');
      return;
    }
    if (removeLock) {
      const updated: NoteFolder = {
        ...activeFolder,
        locked: false,
        lockSalt: undefined,
        lockHash: undefined,
        lockIterations: undefined,
        updatedAt: Date.now(),
      };
      await onUpdateFolder(updated);
      setUnlockedFolderIds((prev) => prev.filter((id) => id !== activeFolder.id));
    } else {
      setUnlockedFolderIds((prev) => (prev.includes(activeFolder.id) ? prev : [...prev, activeFolder.id]));
    }
    setFolderPassword('');
  };

  const handleDeleteFolder = async () => {
    if (!activeFolder) return;
    await onDeleteFolder(activeFolder.id);
    setUnlockedFolderIds((prev) => prev.filter((id) => id !== activeFolder.id));
    setExpandedFolderIds((prev) => prev.filter((id) => id !== activeFolder.id));
    setActiveFolderId(null);
  };

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  };

  const togglePresetTag = (tag: string) => {
    if (isNoteLocked) return;
    const normalized = tag.toLowerCase();
    const tags = normalizeTags(draftTags);
    const next = tags.includes(normalized)
      ? tags.filter((t) => t !== normalized)
      : [...tags, normalized];
    setDraftTags(next.join(', '));
  };

  return (
    <div
      className={`grid gap-6 w-full ${
        isEditorWide ? 'max-w-none' : 'max-w-5xl mx-auto'
      } ${isEditorWide ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[260px_1fr]'}`}
    >
      {!isEditorWide && (
        <aside className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Buscar</p>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar titulo o texto..."
            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          />
          <input
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="Tags (coma separada)"
            className="mt-2 w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-slate-500">Notas</p>
            <button
              onClick={() => setNotesTreeExpanded((prev) => !prev)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400"
              title={notesTreeExpanded ? 'Ocultar' : 'Mostrar'}
            >
              {notesTreeExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
            </button>
          </div>
          {notesTreeExpanded && (
            <>
              {isFilterActive ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Carpetas</p>
                    {filteredTreeFolders.length === 0 ? (
                      <p className="text-xs text-slate-600">Sin carpetas.</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredTreeFolders.map((folder) => {
                          const locked = folder.locked && !unlockedFolderIds.includes(folder.id);
                          const isActive = activeFolderId === folder.id;
                          return (
                            <button
                              key={folder.id}
                              onClick={() => setActiveFolderId(folder.id)}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs ${
                                isActive ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'
                              } ${locked ? 'opacity-70' : ''}`}
                            >
                              <FolderIcon className="w-4 h-4" />
                              <span className="truncate">{folder.name}</span>
                              {folder.locked && <span className="ml-auto text-[10px] text-amber-400">LOCK</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Documentos</p>
                    {filteredTreeNotes.length === 0 ? (
                      <p className="text-xs text-slate-600">Sin documentos.</p>
                    ) : (
                      <div className="space-y-1">
                        {filteredTreeNotes.map((note) => {
                          const isNoteActive = activeNoteId === note.id;
                          const folderLocked = note.folderId
                            ? !!(folderMap.get(note.folderId)?.locked && !unlockedFolderIds.includes(note.folderId))
                            : false;
                          return (
                            <button
                              key={note.id}
                              onClick={() => {
                                if (folderLocked) return;
                                setActiveFolderId(note.folderId ?? null);
                                setActiveNoteId(note.id);
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs ${
                                isNoteActive ? 'bg-indigo-600/10 text-indigo-200' : 'text-slate-400 hover:bg-slate-800'
                              } ${folderLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                              disabled={folderLocked}
                            >
                              <DocumentIcon className="w-3.5 h-3.5" />
                              <span className="truncate">{note.title || 'Untitled'}</span>
                              {note.locked && <span className="ml-auto text-[10px] text-amber-400">LOCK</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="mt-1 space-y-1">
                    {(folderChildren.get(null) || []).map((folder) => {
                      const renderFolder = (node: NoteFolder, depth: number) => {
                        const childFolders = folderChildren.get(node.id) || [];
                        const childNotes = notesByFolder.get(node.id) || [];
                        const hasChildren = childFolders.length + childNotes.length > 0;
                        const isExpanded = expandedFolderIds.includes(node.id);
                        const isActive = activeFolderId === node.id;
                        const locked = node.locked && !unlockedFolderIds.includes(node.id);
                        return (
                          <div key={node.id}>
                            <div className="flex items-center" style={{ paddingLeft: 8 + depth * 12 }}>
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
                                onClick={() => setActiveFolderId(node.id)}
                                className={`flex-1 flex items-center gap-2 px-2 py-1 rounded-md text-sm ${isActive ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'} ${locked ? 'opacity-70' : ''}`}
                              >
                                <FolderIcon className="w-4 h-4" />
                                <span className="truncate">{node.name}</span>
                                {node.locked && <span className="ml-auto text-[10px] text-amber-400">LOCK</span>}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="mt-1 space-y-1">
                                {childFolders.map((child) => renderFolder(child, depth + 1))}
                                {childNotes.map((note) => {
                                  const isNoteActive = activeNoteId === note.id;
                                  return (
                                    <button
                                      key={note.id}
                                      onClick={() => {
                                        if (locked) return;
                                        setActiveFolderId(node.id);
                                        setActiveNoteId(note.id);
                                      }}
                                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs ${isNoteActive ? 'bg-indigo-600/10 text-indigo-200' : 'text-slate-400 hover:bg-slate-800'} ${locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                                      style={{ paddingLeft: 20 + (depth + 1) * 12 }}
                                      disabled={locked}
                                    >
                                      <DocumentIcon className="w-3.5 h-3.5" />
                                      <span className="truncate">{note.title || 'Untitled'}</span>
                                      {note.locked && <span className="ml-auto text-[10px] text-amber-400">LOCK</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      };
                      return renderFolder(folder, 0);
                    })}
                    {(folderChildren.get(null) || []).length === 0 && (
                      <p className="text-xs text-slate-600">Sin carpetas.</p>
                    )}
                    {(notesByFolder.get(null) || []).map((note) => {
                      const isNoteActive = activeNoteId === note.id;
                      return (
                        <button
                          key={note.id}
                          onClick={() => {
                            setActiveFolderId(null);
                            setActiveNoteId(note.id);
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs ${isNoteActive ? 'bg-indigo-600/10 text-indigo-200' : 'text-slate-400 hover:bg-slate-800'}`}
                        >
                          <DocumentIcon className="w-3.5 h-3.5" />
                          <span className="truncate">{note.title || 'Untitled'}</span>
                          {note.locked && <span className="ml-auto text-[10px] text-amber-400">LOCK</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-slate-500">Crear</p>
          <div className="flex gap-2">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Nueva carpeta"
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleCreateFolder}
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              placeholder="Nuevo archivo"
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={() => {
                setLinkTaskOnCreate(true);
                handleCreateNote();
              }}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs"
              title="Crear y vincular tarea"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
            <button
              onClick={handleCreateNote}
              className="px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs"
              title="Crear sin vincular"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {activeFolder && (
          <div className="border border-slate-800 rounded-lg p-3 space-y-2">
            <p className="text-xs uppercase tracking-wider text-slate-500">Seguridad carpeta</p>
            {activeFolder.locked && !unlockedFolderIds.includes(activeFolder.id) ? (
              <>
                <input
                  type="password"
                  value={folderPassword}
                  onChange={(e) => setFolderPassword(e.target.value)}
                  placeholder="Contrasena"
                  autoComplete="current-password"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleUnlockFolder(false)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1 rounded"
                >
                  Desbloquear carpeta
                </button>
              </>
            ) : (
              <>
                <input
                  type="password"
                  value={folderPassword}
                  onChange={(e) => setFolderPassword(e.target.value)}
                  placeholder={activeFolder.locked ? 'Contrasena actual' : 'Nueva contrasena'}
                  autoComplete={activeFolder.locked ? 'current-password' : 'new-password'}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
                />
                {activeFolder.locked ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUnlockFolder(false)}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs py-1 rounded"
                    >
                      Desbloquear
                    </button>
                    <button
                      onClick={() => handleUnlockFolder(true)}
                      className="flex-1 bg-rose-600 hover:bg-rose-500 text-white text-xs py-1 rounded"
                    >
                      Quitar lock
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLockFolder}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1 rounded"
                  >
                    Activar lock
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleDeleteFolder}
              className="w-full bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 border border-rose-500/30 text-xs py-1 rounded"
            >
              Borrar carpeta
            </button>
          </div>
        )}
        </aside>
      )}

      <section
        className={`bg-slate-900/40 border border-slate-800 rounded-xl p-5 flex flex-col ${
          isEditorWide ? 'min-h-[80vh]' : 'min-h-[60vh]'
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <DocumentIcon className="w-4 h-4" />
            <span>Documentos</span>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-slate-500">Guardando...</span>}
            <button
              onClick={() => setIsEditorWide((prev) => !prev)}
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              title={isEditorWide ? 'Reducir editor' : 'Expandir editor'}
            >
              {isEditorWide ? <ArrowsCollapseIcon className="w-4 h-4" /> : <ArrowsExpandIcon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {isFolderLocked ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <p className="text-sm">Carpeta bloqueada.</p>
          </div>
        ) : (
          <div className={`grid gap-4 flex-1 ${isEditorWide ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[220px_1fr]'}`}>
            {!isEditorWide && (
              <div className="border border-slate-800 rounded-lg p-3 max-h-[60vh] overflow-y-auto">
                {filteredNotes.length === 0 && (
                  <p className="text-xs text-slate-500">No hay documentos.</p>
                )}
                {filteredNotes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => {
                      setActiveNoteId(note.id);
                    }}
                    className={`w-full text-left px-2 py-2 rounded-md text-sm flex items-center gap-2 ${activeNoteId === note.id ? 'bg-indigo-600/10 text-indigo-200' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    <DocumentIcon className="w-4 h-4" />
                    <span className="truncate">{note.title || 'Untitled'}</span>
                    {note.locked && <span className="ml-auto text-[10px] text-amber-400">LOCK</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 flex flex-col">
              {!activeNote ? (
                <NotePanelEmptyState />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="Titulo"
                      className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                      disabled={isNoteLocked}
                    />
                    <button
                      onClick={() => setIsTaskLinkerOpen(!isTaskLinkerOpen)}
                      className="p-2 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 border border-indigo-500/30"
                      title="Vincular tarea"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void persistDraft()}
                      disabled={!activeNote || isNoteLocked}
                      className="px-3 py-2 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/30 text-xs disabled:opacity-50"
                      title="Guardar"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={handleDeleteCurrentNote}
                      className="p-2 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 border border-rose-500/30"
                      title="Eliminar"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Task Linker Panel */}
                  {isTaskLinkerOpen && (
                    <div className="mb-3 p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-slate-200">Vincular a tarea</h4>
                        <button
                          onClick={() => setIsTaskLinkerOpen(false)}
                          className="text-slate-400 hover:text-slate-200"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* Priority Filter */}
                      <div className="flex gap-1 mb-2">
                        <button
                          onClick={() => setSelectedPriority('all')}
                          className={`px-2 py-1 text-xs rounded ${
                            selectedPriority === 'all' 
                              ? 'bg-indigo-600 text-white' 
                              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          Todas
                        </button>
                        {(['P1', 'P2', 'P3', 'P4'] as Priority[]).map(priority => (
                          <button
                            key={priority}
                            onClick={() => setSelectedPriority(priority)}
                            className={`px-2 py-1 text-xs rounded ${
                              selectedPriority === priority 
                                ? 'bg-indigo-600 text-white' 
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                          >
                            {priority}
                          </button>
                        ))}
                      </div>
                      
                      {/* Search Input */}
                      <input
                        type="text"
                        value={taskQuery}
                        onChange={(e) => setTaskQuery(e.target.value)}
                        placeholder="Buscar tarea..."
                        className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 mb-2"
                      />
                      
                      {/* Task List */}
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {filteredTodos.slice(0, 8).map(todo => {
                          const taskNumber = getTaskNumber(todo, todos);
                          const isAlreadyLinked = activeNoteId ? todo.linkedNotes?.includes(activeNoteId) : false;
                          
                          return (
                            <button
                              key={todo.id}
                              onClick={() => linkTaskToNote(todo.id)}
                              disabled={isAlreadyLinked}
                              className={`w-full text-left text-xs px-2 py-1 rounded flex items-center gap-2 ${
                                isAlreadyLinked 
                                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                                  : 'text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              <span className={`font-mono text-xs ${
                                todo.priority === 'P1' ? 'text-red-400' :
                                todo.priority === 'P2' ? 'text-orange-400' :
                                todo.priority === 'P3' ? 'text-blue-400' :
                                'text-slate-500'
                              }`}>
                                {todo.priority}
                              </span>
                              <span className="font-mono text-slate-500">#{taskNumber}</span>
                              <span className="truncate flex-1">{todo.text}</span>
                              {isAlreadyLinked && (
                                <span className="text-xs text-indigo-400">Ya vinculada</span>
                              )}
                            </button>
                          );
                        })}
                        {filteredTodos.length === 0 && (
                          <p className="text-xs text-slate-500 text-center py-2">
                            No hay tareas disponibles
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={editorTextareaRef}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder={isNoteLocked ? 'Documento bloqueado' : 'Escribe aqui...'}
                    className={`flex-1 ${isEditorWide ? 'min-h-[70vh]' : 'min-h-[240px]'} bg-slate-950 border border-slate-800 rounded p-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 resize-none`}
                    disabled={isNoteLocked}
                  />
                  <div className="mt-3">
                    <button
                      onClick={() => setIsOptionsOpen((prev) => !prev)}
                      className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400 hover:text-slate-200"
                    >
                      Opciones
                      {isOptionsOpen ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                    </button>
                    {isOptionsOpen && (
                      <div className="mt-3 space-y-4">
                        <div>
                          <label className="text-xs uppercase tracking-wider text-slate-500">Tags</label>
                          <input
                            value={draftTags}
                            onChange={(e) => setDraftTags(e.target.value)}
                            placeholder="idea, prompt, privado"
                            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                            disabled={isNoteLocked}
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            {PRESET_TAGS.map((tag) => {
                              const active = draftTagList.includes(tag.toLowerCase());
                              return (
                                <button
                                  key={tag}
                                  onClick={() => togglePresetTag(tag)}
                                  disabled={isNoteLocked}
                                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                                    active
                                      ? 'bg-emerald-600/20 border-emerald-400 text-emerald-200'
                                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="border border-slate-800 rounded-lg p-3 space-y-2">
                          <p className="text-xs uppercase tracking-wider text-slate-500">Seguridad documento</p>
                          <button
                            onClick={handleExportToPDF}
                            disabled={!activeNote || isNoteLocked}
                            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs py-1 rounded disabled:opacity-50"
                          >
                            Exportar a PDF
                          </button>
                          {activeNote.locked ? (
                            <>
                              <input
                                type="password"
                                value={noteUnlockPassword}
                                onChange={(e) => setNoteUnlockPassword(e.target.value)}
                                placeholder="Contrasena"
                                autoComplete="current-password"
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleUnlockNote}
                                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-1 rounded"
                                >
                                  Desbloquear
                                </button>
                                <button
                                  onClick={handleRemoveNoteLock}
                                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white text-xs py-1 rounded"
                                >
                                  Quitar lock
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <input
                                type="password"
                                value={noteLockPassword}
                                onChange={(e) => setNoteLockPassword(e.target.value)}
                                placeholder="Contrasena"
                                autoComplete="new-password"
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                              />
                              <input
                                type="password"
                                value={noteLockConfirm}
                                onChange={(e) => setNoteLockConfirm(e.target.value)}
                                placeholder="Confirmar"
                                autoComplete="new-password"
                                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                              />
                              <button
                                onClick={handleLockNote}
                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-1 rounded"
                              >
                                Bloquear documento
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {localError && (
          <p className="mt-3 text-xs text-rose-400">{localError}</p>
        )}
      </section>
    </div>
  );
};
