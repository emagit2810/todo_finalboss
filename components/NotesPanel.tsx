import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NoteDoc, NoteFolder } from '../types';
import { DocumentIcon, FolderIcon, PlusIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, ArrowsCollapseIcon, ArrowsExpandIcon } from './Icons';
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
}

const PASSWORD_ITERATIONS = 100000;
const AUTOSAVE_DELAY_MS = 700;
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
}) => {
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [notesTreeExpanded, setNotesTreeExpanded] = useState(true);
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [isEditorWide, setIsEditorWide] = useState(false);

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
  const cryptoReady = typeof crypto !== 'undefined' && !!crypto.subtle;

  const saveTimerRef = useRef<number | null>(null);
  const skipSaveRef = useRef(false);
  const noteKeysRef = useRef<Map<string, CryptoKey>>(new Map());
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

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const tagFilters = normalizeTags(tagQuery);
    let list = notes;
    if (activeFolderId) {
      list = list.filter((n) => n.folderId === activeFolderId);
    }
    if (query) {
      list = list.filter((n) => {
        const text = `${n.title} ${(n.content || '')} ${(n.tags || []).join(' ')}`.toLowerCase();
        return text.includes(query);
      });
    }
    if (tagFilters.length > 0) {
      list = list.filter((n) => {
        const tags = (n.tags || []).map((t) => t.toLowerCase());
        return tagFilters.every((t) => tags.includes(t));
      });
    }
    return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [notes, activeFolderId, searchQuery, tagQuery]);

  const activeNote = activeNoteId ? notes.find((n) => n.id === activeNoteId) || null : null;
  const isNoteLocked = !!(activeNote?.locked && !unlockedNoteIds.includes(activeNote.id));

  const loadNoteToDraft = async (note: NoteDoc | null) => {
    skipSaveRef.current = true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
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

  const scheduleSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void persistDraft();
    }, AUTOSAVE_DELAY_MS);
  };

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
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    scheduleSave();
  }, [draftTitle, draftContent, draftTags]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

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
    <div className={`max-w-5xl mx-auto grid gap-6 ${isEditorWide ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[260px_1fr]'}`}>
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
            <div className="space-y-1">
              <button
                onClick={() => setActiveFolderId(null)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm ${!activeFolderId ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                <FolderIcon className="w-4 h-4" />
                Todas las notas
              </button>
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
                                  onClick={async () => {
                                    if (locked) return;
                                    await persistDraft();
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
                      onClick={async () => {
                        await persistDraft();
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
              onClick={handleCreateNote}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs"
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

      <section className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 min-h-[60vh] flex flex-col">
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
                    onClick={async () => {
                      await persistDraft();
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
                      onClick={handleDeleteCurrentNote}
                      className="p-2 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 border border-rose-500/30"
                      title="Eliminar"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder={isNoteLocked ? 'Documento bloqueado' : 'Escribe aqui...'}
                    className="flex-1 min-h-[240px] bg-slate-950 border border-slate-800 rounded p-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 resize-none"
                    disabled={isNoteLocked}
                  />
                  <div className="mt-3">
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

                  <div className="mt-4 border border-slate-800 rounded-lg p-3 space-y-2">
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
