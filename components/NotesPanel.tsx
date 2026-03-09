import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NoteContentFormat, NoteDoc, NoteFolder, Todo, Priority, AttachmentMeta, PdfExportMode, InlineImageInsertSource } from '../types';
import { DocumentIcon, FolderIcon, PlusIcon, TrashIcon, ChevronDownIcon, ChevronRightIcon, ArrowsCollapseIcon, ArrowsExpandIcon, XMarkIcon } from './Icons';
import { useReactToPrint } from 'react-to-print';
import { NotePrintDocument, NOTE_PRINT_PAGE_STYLE } from './notes/NotePrintDocument';
import { NoteMarkdownPreview } from './notes/NoteMarkdownPreview';
import { PrintableNotePayload, exportNotePdf, isExternalPdfExporterConfigured } from '../exporters/notePdf';
import { deriveKeyAndHash, decryptWithKey, encryptWithKey, generateSalt } from '../utils/crypto';
import {
  DEFAULT_NEW_NOTE_CONTENT_FORMAT,
  NOTE_CONTENT_FORMAT_LABELS,
  NOTE_EXPORT_MODE_STORAGE_KEY,
  PDF_EXPORT_MODE_LABELS,
  buildNotePdfFileName,
  normalizeNoteContentFormat,
  parsePdfExportMode,
} from '../utils/noteContent';
import {
  NoteInlineImageAsset,
  extractInlineImageRefs,
  insertInlineImageTokensAtSelection,
  readBlobAsDataUrl,
  removeInlineImageTokenByAttachmentId,
  replaceInlineImageTokens,
} from '../utils/noteInlineImages';

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
  onOpenAttachment?: (attachment: AttachmentMeta) => void;
  onDeleteNoteAttachment?: (noteId: string, attachmentId: string) => void;
  onPrepareInlineNoteImages?: (
    noteId: string,
    files: File[],
    source: InlineImageInsertSource
  ) => Promise<AttachmentMeta[]>;
  onReadAttachmentBlob?: (attachmentId: string) => Promise<Blob | null>;
  activeDropNoteId?: string | null;
  onNotify?: (message: string, type: 'success' | 'error') => void;
}

const PASSWORD_ITERATIONS = 100000;
const NOTE_PRINT_LOCALE = 'es-CO';
const PRESET_TAGS = [
  'prompt estudio',
  'prompt problema',
  'prompt idea',
  'ideas',
  'clave',
  'tema estudiar',
];
const TEXT_ATTACHMENT_EXTENSION_REGEX = /\.txt$/i;

const normalizeTags = (value: string) => {
  const tags = value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return Array.from(new Set(tags.map((t) => t.toLowerCase())));
};

const isPlainTextAttachment = (attachment: AttachmentMeta) =>
  attachment.kind !== 'inline-image' &&
  (attachment.mimeType === 'text/plain' || TEXT_ATTACHMENT_EXTENSION_REGEX.test(attachment.name));

const buildInlinePreviewSignature = (refs: Array<{ attachmentId: string; alt: string }>) =>
  refs.map((ref) => `${ref.attachmentId}:${ref.alt}`).join('|');

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
  onOpenAttachment,
  onDeleteNoteAttachment,
  onPrepareInlineNoteImages,
  onReadAttachmentBlob,
  activeDropNoteId = null,
  onNotify,
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
  const [draftContentFormat, setDraftContentFormat] = useState<NoteContentFormat>('plain');
  const [draftTags, setDraftTags] = useState('');

  const [noteLockPassword, setNoteLockPassword] = useState('');
  const [noteLockConfirm, setNoteLockConfirm] = useState('');
  const [noteUnlockPassword, setNoteUnlockPassword] = useState('');

  const [folderPassword, setFolderPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportingMode, setExportingMode] = useState<PdfExportMode | null>(null);
  const [preferredExportMode, setPreferredExportMode] = useState<PdfExportMode | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return parsePdfExportMode(window.localStorage.getItem(NOTE_EXPORT_MODE_STORAGE_KEY));
    } catch (_error) {
      return null;
    }
  });
  
  // States for task linking
  const [isTaskLinkerOpen, setIsTaskLinkerOpen] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<Priority | 'all'>('all');
  const [taskQuery, setTaskQuery] = useState('');
  const [linkTaskOnCreate, setLinkTaskOnCreate] = useState(false);
  
  const cryptoReady = typeof crypto !== 'undefined' && !!crypto.subtle;

  const noteKeysRef = useRef<Map<string, CryptoKey>>(new Map());
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inlineImageInputRef = useRef<HTMLInputElement | null>(null);
  const printDocumentRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingPrintRenderResolveRef = useRef<(() => void) | null>(null);
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<string[]>([]);
  const [unlockedFolderIds, setUnlockedFolderIds] = useState<string[]>([]);
  const [inlineImagePreviewMap, setInlineImagePreviewMap] = useState<Record<string, NoteInlineImageAsset>>({});
  const [inlineImageBusy, setInlineImageBusy] = useState(false);
  const [preparedPrintNote, setPreparedPrintNote] = useState<PrintableNotePayload | null>(null);

  const externalExporterConfigured = isExternalPdfExporterConfigured();
  const resolvedPreferredExportMode =
    preferredExportMode === 'external-chromium' && !externalExporterConfigured
      ? null
      : preferredExportMode;
  const primaryExportMode = resolvedPreferredExportMode || 'offline-browser';

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
  const isActiveDropNote = !!(activeNote && activeDropNoteId === activeNote.id);
  const inlineImageRefs = useMemo(
    () => (draftContentFormat === 'markdown' ? extractInlineImageRefs(draftContent) : []),
    [draftContent, draftContentFormat]
  );
  const inlineImagePreviewSignature = useMemo(
    () => buildInlinePreviewSignature(inlineImageRefs),
    [inlineImageRefs]
  );
  const uniqueInlineImageRefs = useMemo(
    () => inlineImageRefs.filter((ref, index, list) => list.findIndex((item) => item.attachmentId === ref.attachmentId) === index),
    [inlineImagePreviewSignature]
  );
  const containsInlineImages = inlineImageRefs.length > 0;
  const visibleNoteAttachments = useMemo(
    () => (activeNote?.attachments || []).filter((attachment) => attachment.kind !== 'inline-image'),
    [activeNote]
  );
  const textAppendixCandidates = useMemo(
    () => visibleNoteAttachments.filter(isPlainTextAttachment),
    [visibleNoteAttachments]
  );
  const orphanInlineAttachments = useMemo(() => {
    if (!activeNote) return [];
    const referencedIds = new Set(inlineImageRefs.map((ref) => ref.attachmentId));
    return (activeNote.attachments || []).filter(
      (attachment) => attachment.kind === 'inline-image' && !referencedIds.has(attachment.id)
    );
  }, [activeNote, inlineImageRefs]);
  const canUseInlineImages =
    !!activeNote &&
    !isNoteLocked &&
    draftContentFormat === 'markdown' &&
    externalExporterConfigured &&
    !!onPrepareInlineNoteImages &&
    !!onReadAttachmentBlob;
  const effectivePrimaryExportMode =
    containsInlineImages && externalExporterConfigured ? 'external-chromium' : primaryExportMode;
  const printableNote = useMemo<PrintableNotePayload | null>(() => {
    if (!activeNote) return null;
    const title = draftTitle.trim() || activeNote.title || 'Untitled';
    return {
      title,
      content: draftContent,
      contentFormat: draftContentFormat,
      updatedAt: activeNote.updatedAt || Date.now(),
      fileName: buildNotePdfFileName(title),
      paper: 'A4',
      locale: NOTE_PRINT_LOCALE,
    };
  }, [activeNote, draftContent, draftContentFormat, draftTitle]);
  const printableDocumentNote = preparedPrintNote || printableNote;

  const reportError = useCallback((message: string) => {
    setLocalError(message);
    onNotify?.(message, 'error');
  }, [onNotify]);

  const reportSuccess = useCallback((message: string) => {
    setLocalError(null);
    onNotify?.(message, 'success');
  }, [onNotify]);

  const persistPreferredExportMode = useCallback((mode: PdfExportMode) => {
    setPreferredExportMode(mode);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(NOTE_EXPORT_MODE_STORAGE_KEY, mode);
    } catch (_error) {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, []);

  const getExportableNote = useCallback(() => {
    if (!activeNote || !printableNote) return null;
    if (isNoteLocked) {
      reportError('Desbloquea el documento para exportar.');
      return null;
    }
    if (!draftContent.trim() && textAppendixCandidates.length === 0) {
      reportError('El documento esta vacio.');
      return null;
    }
    setLocalError(null);
    return printableNote;
  }, [activeNote, printableNote, isNoteLocked, draftContent, reportError, textAppendixCandidates.length]);

  const hydratePrintableNoteForExport = useCallback(async (
    note: PrintableNotePayload,
    options?: { includeInlineImages?: boolean }
  ) => {
    if (!onReadAttachmentBlob) {
      return note;
    }

    const attachments = activeNote?.attachments || [];
    const textAppendices = await Promise.all(
      attachments
        .filter(isPlainTextAttachment)
        .map(async (attachment) => {
          const blob = await onReadAttachmentBlob(attachment.id);
          if (!blob) return null;
          try {
            return {
              id: attachment.id,
              title: attachment.name,
              text: (await blob.text()).replace(/^\uFEFF/, ''),
              mimeType: 'text/plain' as const,
            };
          } catch (_error) {
            return null;
          }
        })
    );

    const nextNote: PrintableNotePayload = {
      ...note,
      appendices: textAppendices.filter((appendix): appendix is NonNullable<typeof appendix> => !!appendix),
    };

    if (!options?.includeInlineImages || note.contentFormat !== 'markdown') {
      return nextNote;
    }

    const refs = extractInlineImageRefs(note.content);
    if (refs.length === 0) {
      return nextNote;
    }

    const assetsList = await Promise.all(refs.map(async (ref) => {
      const attachment = attachments.find((item) => item.id === ref.attachmentId && item.kind === 'inline-image');
      if (!attachment) return null;
      const originalBlob = await onReadAttachmentBlob(attachment.id);
      const blob = originalBlob || (
        attachment.previewAttachmentId
          ? await onReadAttachmentBlob(attachment.previewAttachmentId)
          : null
      );
      if (!blob) return null;

      return {
        id: attachment.id,
        alt: attachment.alt || ref.alt || attachment.name || 'imagen',
        dataUrl: await readBlobAsDataUrl(blob),
        mimeType: blob.type || attachment.mimeType,
        width: attachment.width,
        height: attachment.height,
      } satisfies NoteInlineImageAsset;
    }));

    const assets = Object.fromEntries(
      assetsList
        .filter((asset): asset is NoteInlineImageAsset => !!asset)
        .map((asset) => [asset.id, asset])
    );

    return {
      ...nextNote,
      assets: Object.values(assets),
      resolvedContent: replaceInlineImageTokens(note.content, (ref) => assets[ref.attachmentId]),
      containsInlineImages: Object.keys(assets).length > 0,
    };
  }, [activeNote, onReadAttachmentBlob]);

  const mountPreparedPrintNote = useCallback((note: PrintableNotePayload) => (
    new Promise<void>((resolve) => {
      pendingPrintRenderResolveRef.current = resolve;
      setPreparedPrintNote(note);
    })
  ), []);

  useEffect(() => {
    if (!preparedPrintNote || !pendingPrintRenderResolveRef.current) return;
    window.requestAnimationFrame(() => {
      pendingPrintRenderResolveRef.current?.();
      pendingPrintRenderResolveRef.current = null;
    });
  }, [preparedPrintNote]);

  const triggerBrowserPrint = useReactToPrint({
    contentRef: printDocumentRef,
    documentTitle: printableDocumentNote ? printableDocumentNote.fileName.replace(/\.pdf$/i, '') : 'documento',
    pageStyle: NOTE_PRINT_PAGE_STYLE,
    onAfterPrint: () => {
      pendingPrintRenderResolveRef.current = null;
      setPreparedPrintNote(null);
    },
    onPrintError: (_location, error) => {
      pendingPrintRenderResolveRef.current = null;
      setPreparedPrintNote(null);
      const message = error instanceof Error ? error.message : 'No se pudo abrir el dialogo de impresion.';
      reportError(message);
    },
  });

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
      setDraftContentFormat(DEFAULT_NEW_NOTE_CONTENT_FORMAT);
      setDraftTags('');
      return;
    }
    setDraftTitle(note.title || '');
    setDraftContentFormat(normalizeNoteContentFormat(note.contentFormat));
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
    let cancelled = false;
    const objectUrls: string[] = [];

    const loadInlineImagePreviews = async () => {
      if (!activeNote || !onReadAttachmentBlob || inlineImageRefs.length === 0) {
        setInlineImagePreviewMap({});
        return;
      }

      const attachments = activeNote.attachments || [];
      const previewEntries = await Promise.all(uniqueInlineImageRefs.map(async (ref) => {
        const attachment = attachments.find((item) => item.id === ref.attachmentId && item.kind === 'inline-image');
        if (!attachment) return null;
        const blobId = attachment.previewAttachmentId || attachment.id;
        const blob = await onReadAttachmentBlob(blobId);
        if (!blob) return null;
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        return [
          attachment.id,
          {
            id: attachment.id,
            alt: attachment.alt || ref.alt || attachment.name || 'imagen',
            dataUrl: objectUrl,
            mimeType: blob.type || attachment.mimeType,
            width: attachment.width,
            height: attachment.height,
          },
        ] as const;
      }));

      if (cancelled) return;
      setInlineImagePreviewMap(
        Object.fromEntries(
          previewEntries.filter((entry): entry is readonly [string, NoteInlineImageAsset] => !!entry)
        )
      );
    };

    void loadInlineImagePreviews();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [activeNote, inlineImagePreviewSignature, onReadAttachmentBlob, uniqueInlineImageRefs]);

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

  const persistDraft = async (overrides?: {
    content?: string;
    attachments?: AttachmentMeta[] | undefined;
    title?: string;
    contentFormat?: NoteContentFormat;
    tags?: string;
  }) => {
    if (!activeNote) return;
    if (isNoteLocked) return;
    setSaving(true);
    try {
      const nextTitle = overrides?.title ?? draftTitle;
      const nextContent = overrides?.content ?? draftContent;
      const nextContentFormat = overrides?.contentFormat ?? draftContentFormat;
      const nextTagsValue = overrides?.tags ?? draftTags;
      const nextAttachments = overrides?.attachments ?? activeNote.attachments;
      const tags = normalizeTags(nextTagsValue);
      const baseUpdate: NoteDoc = {
        ...activeNote,
        title: nextTitle.trim() || 'Untitled',
        contentFormat: nextContentFormat,
        tags,
        attachments: nextAttachments,
        updatedAt: Date.now(),
      };

      if (activeNote.locked) {
        const key = noteKeysRef.current.get(activeNote.id);
        if (!key) {
          setLocalError('No se encontro clave para cifrar.');
          return;
        }
        const { cipherText, iv } = await encryptWithKey(nextContent, key);
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
          content: nextContent,
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

  const focusEditorAt = useCallback((position: number) => {
    window.requestAnimationFrame(() => {
      const editor = editorTextareaRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(position, position);
    });
  }, []);

  const insertInlineImages = useCallback(async (
    files: File[],
    source: InlineImageInsertSource,
    selectionStart?: number,
    selectionEnd?: number
  ) => {
    if (!activeNote) return;
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    if (!canUseInlineImages || !onPrepareInlineNoteImages) {
      reportError('Las imagenes inline requieren Markdown y PDF externo configurado.');
      return;
    }

    setInlineImageBusy(true);
    setLocalError(null);
    try {
      const preparedAttachments = await onPrepareInlineNoteImages(activeNote.id, imageFiles, source);
      if (preparedAttachments.length === 0) return;

      const editor = editorTextareaRef.current;
      const start = selectionStart ?? editor?.selectionStart ?? draftContent.length;
      const end = selectionEnd ?? editor?.selectionEnd ?? start;
      const { nextContent, nextSelection } = insertInlineImageTokensAtSelection({
        content: draftContent,
        selectionStart: start,
        selectionEnd: end,
        attachments: preparedAttachments,
      });

      const nextAttachments = [...(activeNote.attachments || []), ...preparedAttachments];
      setDraftContent(nextContent);
      await persistDraft({
        content: nextContent,
        attachments: nextAttachments,
      });
      focusEditorAt(nextSelection);
      reportSuccess(`${preparedAttachments.length} imagen(es) insertada(s) en la nota.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron insertar las imagenes.';
      reportError(message);
    } finally {
      setInlineImageBusy(false);
      if (inlineImageInputRef.current) {
        inlineImageInputRef.current.value = '';
      }
    }
  }, [
    activeNote,
    canUseInlineImages,
    draftContent,
    focusEditorAt,
    onPrepareInlineNoteImages,
    persistDraft,
    reportError,
    reportSuccess,
  ]);

  const handleInlineImagePickerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    void insertInlineImages(files, 'picker');
  };

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (imageFiles.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void insertInlineImages(
      imageFiles,
      'paste',
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd
    );
  };

  const handleEditorDragOverCapture = (event: React.DragEvent<HTMLDivElement>) => {
    const imageFiles = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleEditorDropCapture = (event: React.DragEvent<HTMLDivElement>) => {
    const imageFiles = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const nativeEvent = event.nativeEvent as DragEvent;
    nativeEvent.stopImmediatePropagation?.();
    void insertInlineImages(
      imageFiles,
      'drop',
      editorTextareaRef.current?.selectionStart,
      editorTextareaRef.current?.selectionEnd
    );
  };

  const handleRemoveInlineImage = useCallback(async (attachmentId: string) => {
    if (!activeNote) return;

    const nextContent = removeInlineImageTokenByAttachmentId(draftContent, attachmentId);
    const nextAttachments = (activeNote.attachments || []).filter((attachment) => attachment.id !== attachmentId);
    setDraftContent(nextContent);

    try {
      await persistDraft({
        content: nextContent,
        attachments: nextAttachments,
      });
      await onDeleteNoteAttachment?.(activeNote.id, attachmentId);
      reportSuccess('Imagen inline eliminada.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo quitar la imagen inline.';
      reportError(message);
    }
  }, [activeNote, draftContent, onDeleteNoteAttachment, persistDraft, reportError, reportSuccess]);

  const handleRestoreInlineImage = useCallback(async (attachment: AttachmentMeta) => {
    if (!activeNote) return;

    const editor = editorTextareaRef.current;
    const start = editor?.selectionStart ?? draftContent.length;
    const end = editor?.selectionEnd ?? start;
    const { nextContent, nextSelection } = insertInlineImageTokensAtSelection({
      content: draftContent,
      selectionStart: start,
      selectionEnd: end,
      attachments: [attachment],
    });

    setDraftContent(nextContent);
    try {
      await persistDraft({ content: nextContent });
      focusEditorAt(nextSelection);
      reportSuccess('Imagen inline reinsertada en el documento.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo reinsertar la imagen inline.';
      reportError(message);
    }
  }, [activeNote, draftContent, focusEditorAt, persistDraft, reportError, reportSuccess]);

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

  useEffect(() => {
    if (!isExportMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isExportMenuOpen]);

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
      contentFormat: DEFAULT_NEW_NOTE_CONTENT_FORMAT,
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
    setDraftContentFormat(DEFAULT_NEW_NOTE_CONTENT_FORMAT);
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
      contentFormat: draftContentFormat,
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
      contentFormat: draftContentFormat,
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

  const runPdfExport = useCallback(async (mode: PdfExportMode) => {
    const noteToExport = getExportableNote();
    if (!noteToExport) return;

    if (mode === 'offline-browser' && containsInlineImages) {
      reportError('Las imagenes inline solo se exportan con PDF alta fidelidad por ahora.');
      return;
    }

    if (mode === 'external-chromium' && !externalExporterConfigured) {
      reportError('Configura VITE_PDF_EXPORT_API_URL para usar PDF alta fidelidad.');
      return;
    }

    setIsExportMenuOpen(false);
    persistPreferredExportMode(mode);

    if (mode === 'external-chromium') {
      setExportingMode(mode);
    } else {
      reportSuccess('Abriendo dialogo de impresion para guardar el PDF.');
    }

    try {
      const hydratedNote = await hydratePrintableNoteForExport(noteToExport, {
        includeInlineImages: mode === 'external-chromium',
      });
      if (mode === 'offline-browser') {
        await mountPreparedPrintNote(hydratedNote);
      }
      await exportNotePdf({
        mode,
        note: hydratedNote,
        triggerPrint: triggerBrowserPrint,
      });
      if (mode === 'external-chromium') {
        reportSuccess(`PDF descargado con ${PDF_EXPORT_MODE_LABELS[mode].toLowerCase()}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo exportar el PDF.';
      reportError(message);
    } finally {
      if (mode === 'external-chromium') {
        setExportingMode(null);
      }
    }
  }, [
    externalExporterConfigured,
    containsInlineImages,
    getExportableNote,
    hydratePrintableNoteForExport,
    mountPreparedPrintNote,
    persistPreferredExportMode,
    reportError,
    reportSuccess,
    triggerBrowserPrint,
  ]);

  const handlePrimaryPdfExport = () => {
    void runPdfExport(effectivePrimaryExportMode);
  };

  const handlePdfExportChoice = (mode: PdfExportMode) => {
    void runPdfExport(mode);
  };

  useEffect(() => {
    const handlePrintShortcut = (event: KeyboardEvent) => {
      const isPrintShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p';
      if (!isPrintShortcut || !activeNote) return;

      event.preventDefault();
      const noteToExport = getExportableNote();
      if (!noteToExport) return;

      if (containsInlineImages && externalExporterConfigured) {
        void runPdfExport('external-chromium');
        return;
      }

      if (resolvedPreferredExportMode) {
        void runPdfExport(resolvedPreferredExportMode);
        return;
      }
      setLocalError(null);
      setIsExportMenuOpen(true);
    };

    window.addEventListener('keydown', handlePrintShortcut);
    return () => window.removeEventListener('keydown', handlePrintShortcut);
  }, [activeNote, containsInlineImages, externalExporterConfigured, getExportableNote, resolvedPreferredExportMode, runPdfExport]);

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
                              data-drop-scope="note"
                              data-drop-id={note.id}
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
                                      data-drop-scope="note"
                                      data-drop-id={note.id}
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
                          data-drop-scope="note"
                          data-drop-id={note.id}
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
                    data-drop-scope="note"
                    data-drop-id={note.id}
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

            <div
              className={`flex-1 flex flex-col ${isActiveDropNote ? 'ring-2 ring-indigo-400/70 rounded-lg p-2 -m-2' : ''}`}
              data-drop-scope={activeNote ? 'note' : undefined}
              data-drop-id={activeNote?.id || undefined}
            >
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
                  {visibleNoteAttachments.length > 0 && (
                    <div className="mb-3 p-2 bg-slate-900/50 border border-slate-700 rounded-lg">
                      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                        Adjuntos
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {visibleNoteAttachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex items-center gap-1 bg-slate-700/50 rounded-lg px-2 py-1 text-xs text-slate-300 group"
                          >
                            <button
                              onClick={() => onOpenAttachment?.(attachment)}
                              className={`flex items-center gap-1 ${
                                isNoteLocked ? 'text-slate-500 cursor-not-allowed' : 'hover:text-indigo-200'
                              }`}
                              title={isNoteLocked ? 'Desbloquea para abrir adjuntos' : attachment.name}
                              disabled={isNoteLocked}
                            >
                              <DocumentIcon className="w-3 h-3 text-indigo-400" />
                              <span className="max-w-[220px] truncate">{attachment.name}</span>
                            </button>
                            <button
                              onClick={() => onDeleteNoteAttachment?.(activeNote.id, attachment.id)}
                              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 ml-1 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={isNoteLocked ? 'Desbloquea para quitar adjuntos' : 'Quitar adjunto'}
                              disabled={isNoteLocked}
                            >
                              <XMarkIcon className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      {textAppendixCandidates.length > 0 && (
                        <p className="mt-2 text-[11px] text-sky-300">
                          Los archivos `.txt` se agregan al final del PDF como anexos de texto.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <label className="text-[11px] uppercase tracking-wider text-slate-500">Formato</label>
                      <select
                        value={draftContentFormat}
                        onChange={(e) => setDraftContentFormat(e.target.value as NoteContentFormat)}
                        disabled={isNoteLocked}
                        className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        {(Object.entries(NOTE_CONTENT_FORMAT_LABELS) as Array<[NoteContentFormat, string]>).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Markdown mejora headings, listas y links en el PDF.
                    </p>
                  </div>
                  {draftContentFormat === 'markdown' && (
                    <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
                      <input
                        ref={inlineImageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        className="hidden"
                        onChange={handleInlineImagePickerChange}
                      />
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-[11px] uppercase tracking-wider text-slate-500">Imagenes inline</p>
                          <p className="text-[11px] text-slate-500">
                            Se guardan en original para IA y con preview ligero para esta vista.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => inlineImageInputRef.current?.click()}
                          disabled={!canUseInlineImages || inlineImageBusy}
                          className="px-3 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-100 border border-indigo-500/30 text-xs disabled:opacity-50"
                        >
                          {inlineImageBusy ? 'Insertando...' : 'Insertar imagen'}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {canUseInlineImages
                          ? 'Puedes pegar con Ctrl+V, arrastrar al editor o elegir archivos.'
                          : 'Las imagenes inline solo estan disponibles en Markdown con PDF alta fidelidad configurado.'}
                      </p>
                    </div>
                  )}
                  {draftContentFormat === 'markdown' && orphanInlineAttachments.length > 0 && (
                    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-[11px] uppercase tracking-wider text-amber-200">Imagenes inline sin referencia</p>
                          <p className="text-[11px] text-amber-100/80">
                            Se conservaron para evitar perdida de datos. Puedes reinsertarlas o borrarlas manualmente.
                          </p>
                        </div>
                        <p className="text-[11px] text-amber-100/80">
                          {orphanInlineAttachments.length} pendiente(s)
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {orphanInlineAttachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-slate-950/50 px-2 py-1 text-xs text-amber-50"
                          >
                            <span className="max-w-[180px] truncate">{attachment.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                void handleRestoreInlineImage(attachment);
                              }}
                              disabled={!canUseInlineImages}
                              className="rounded bg-amber-500/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
                            >
                              Reinsertar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handleRemoveInlineImage(attachment.id);
                              }}
                              disabled={isNoteLocked}
                              className="rounded bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
                            >
                              Borrar
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div
                    className="flex-1"
                    onDragOverCapture={handleEditorDragOverCapture}
                    onDropCapture={handleEditorDropCapture}
                  >
                    <textarea
                      ref={editorTextareaRef}
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      onPaste={handleEditorPaste}
                      placeholder={isNoteLocked ? 'Documento bloqueado' : 'Escribe aqui...'}
                      className={`w-full ${isEditorWide ? 'min-h-[70vh]' : 'min-h-[240px]'} bg-slate-950 border border-slate-800 rounded p-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 resize-none`}
                      disabled={isNoteLocked}
                    />
                  </div>
                  {draftContentFormat === 'markdown' && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-wider text-slate-500">Vista previa Markdown</p>
                          <p className="text-[11px] text-slate-500">
                            Asi se vera el documento con texto e imagenes inline.
                          </p>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {containsInlineImages
                            ? 'Si hay imagenes inline, el PDF usara el motor externo.'
                            : 'Sin imagenes inline, puedes seguir exportando normal.'}
                        </p>
                      </div>
                      <NoteMarkdownPreview
                        content={draftContent}
                        imageSources={inlineImagePreviewMap}
                        onRemoveImage={
                          canUseInlineImages
                            ? (attachmentId) => {
                                void handleRemoveInlineImage(attachmentId);
                              }
                            : undefined
                        }
                      />
                    </div>
                  )}
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
                          <div className="relative" ref={exportMenuRef}>
                            <div className="flex rounded overflow-hidden border border-slate-700">
                              <button
                                onClick={handlePrimaryPdfExport}
                                disabled={!activeNote || isNoteLocked || exportingMode === 'external-chromium'}
                                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs py-2 px-3 text-left disabled:opacity-50"
                              >
                                {exportingMode === 'external-chromium' ? 'Exportando PDF...' : 'Exportar PDF'}
                              </button>
                              <button
                                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                                disabled={!activeNote || isNoteLocked || exportingMode === 'external-chromium'}
                                className="px-3 bg-slate-900 hover:bg-slate-800 text-slate-200 border-l border-slate-700 disabled:opacity-50"
                                title="Elegir motor de exportacion"
                              >
                                <ChevronDownIcon className={`w-4 h-4 transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                              <span>Motor actual: {PDF_EXPORT_MODE_LABELS[effectivePrimaryExportMode]}</span>
                              <span>{containsInlineImages ? 'Imagenes inline: fuerza PDF alta fidelidad' : 'Ctrl+P / Cmd+P'}</span>
                            </div>
                            {isExportMenuOpen && (
                              <div className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-950 shadow-xl">
                                <button
                                  onClick={() => handlePdfExportChoice('offline-browser')}
                                  disabled={containsInlineImages}
                                  className="w-full text-left px-3 py-3 hover:bg-slate-900 border-b border-slate-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                  <div className="text-sm text-slate-100">{PDF_EXPORT_MODE_LABELS['offline-browser']}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {containsInlineImages
                                      ? 'No disponible: esta nota usa imagenes inline.'
                                      : 'Texto seleccionable, links reales y print-to-PDF local.'}
                                  </div>
                                </button>
                                <button
                                  onClick={() => handlePdfExportChoice('external-chromium')}
                                  disabled={!externalExporterConfigured}
                                  className="w-full text-left px-3 py-3 hover:bg-slate-900 disabled:hover:bg-transparent disabled:opacity-50"
                                >
                                  <div className="text-sm text-slate-100">{PDF_EXPORT_MODE_LABELS['external-chromium']}</div>
                                  <div className="text-[11px] text-slate-500">
                                    Motor externo Chromium/Playwright para PDF mas consistente.
                                  </div>
                                </button>
                                {!externalExporterConfigured && (
                                  <p className="px-3 pb-3 text-[11px] text-amber-400">
                                    Configura `VITE_PDF_EXPORT_API_URL` para habilitar este modo.
                                  </p>
                                )}
                                {containsInlineImages && (
                                  <p className="px-3 pb-3 text-[11px] text-sky-300">
                                    Esta nota contiene imagenes inline. El PDF se exporta mejor con el motor externo.
                                  </p>
                                )}
                                {textAppendixCandidates.length > 0 && (
                                  <p className="px-3 pb-3 text-[11px] text-emerald-300">
                                    Los adjuntos `.txt` se anexan al final del PDF.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                          {(activeNote.attachments || []).length > 0 && (
                            <p className="text-[11px] text-amber-300">
                              El bloqueo protege el texto de la nota, pero no cifra los adjuntos ya guardados en IndexedDB.
                            </p>
                          )}
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
      {printableDocumentNote && <NotePrintDocument ref={printDocumentRef} note={printableDocumentNote} />}
    </div>
  );
};
