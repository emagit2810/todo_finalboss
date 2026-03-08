import { NoteContentFormat, PdfExportMode } from '../types';

export const NOTE_EXPORT_MODE_STORAGE_KEY = 'todo_app:notes:pdf-export-mode';
export const DEFAULT_NEW_NOTE_CONTENT_FORMAT: NoteContentFormat = 'markdown';
export const FALLBACK_NOTE_CONTENT_FORMAT: NoteContentFormat = 'plain';

export const NOTE_CONTENT_FORMAT_LABELS: Record<NoteContentFormat, string> = {
  plain: 'Texto plano',
  markdown: 'Markdown',
};

export const PDF_EXPORT_MODE_LABELS: Record<PdfExportMode, string> = {
  'offline-browser': 'PDF offline',
  'external-chromium': 'PDF alta fidelidad',
};

export const normalizeNoteContentFormat = (
  format?: NoteContentFormat | null
): NoteContentFormat => (format === 'markdown' ? 'markdown' : FALLBACK_NOTE_CONTENT_FORMAT);

export const parsePdfExportMode = (value?: string | null): PdfExportMode | null => {
  if (value === 'offline-browser' || value === 'external-chromium') {
    return value;
  }
  return null;
};

export const buildNotePdfFileName = (title: string) => {
  const safeBase = (title || 'documento')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim();
  return `${safeBase || 'documento'}.pdf`;
};
