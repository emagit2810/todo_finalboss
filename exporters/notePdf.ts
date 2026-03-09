import { NoteContentFormat, PdfExportMode } from '../types';

export interface PrintableNoteAsset {
  id: string;
  alt: string;
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface PrintableNoteAppendix {
  id: string;
  title: string;
  text: string;
  mimeType: 'text/plain';
}

export interface PrintableNotePayload {
  title: string;
  content: string;
  contentFormat: NoteContentFormat;
  updatedAt: number;
  fileName: string;
  paper: 'A4';
  locale: string;
  resolvedContent?: string;
  assets?: PrintableNoteAsset[];
  appendices?: PrintableNoteAppendix[];
  containsInlineImages?: boolean;
}

const getExternalPdfExportUrl = () => (import.meta.env.VITE_PDF_EXPORT_API_URL || '').trim();
const getExternalPdfBearerToken = () => (import.meta.env.VITE_PDF_EXPORT_BEARER_TOKEN || '').trim();

const triggerBlobDownload = (blob: Blob, fileName: string) => {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
};

const extractExportErrorMessage = async (response: Response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const payload = await response.json();
      if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
      if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail.trim();
    } catch (_error) {
      // Ignore JSON parsing issues and fall through to text parsing.
    }
  }

  try {
    const text = (await response.text()).trim();
    if (text) return text.slice(0, 240);
  } catch (_error) {
    // Ignore text parsing issues and use the generic message below.
  }

  return `Exportador PDF respondio con ${response.status}.`;
};

export const isExternalPdfExporterConfigured = () => getExternalPdfExportUrl().length > 0;

export const exportNotePdfOffline = async (triggerPrint: (() => void | Promise<void>) | undefined) => {
  if (!triggerPrint) {
    throw new Error('No se encontro el motor de impresion local.');
  }
  await triggerPrint();
};

export const exportNotePdfExternal = async (note: PrintableNotePayload) => {
  const apiUrl = getExternalPdfExportUrl();
  if (!apiUrl) {
    throw new Error('Configura VITE_PDF_EXPORT_API_URL para usar PDF alta fidelidad.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const bearerToken = getExternalPdfBearerToken();
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: note.title,
      content: note.content,
      resolvedContent: note.resolvedContent || note.content,
      contentFormat: note.contentFormat,
      fileName: note.fileName,
      paper: note.paper,
      locale: note.locale,
      assets: note.assets || [],
      appendices: note.appendices || [],
      containsInlineImages: note.containsInlineImages || false,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractExportErrorMessage(response));
  }

  const pdfBlob = await response.blob();
  triggerBlobDownload(pdfBlob, note.fileName);
};

export const exportNotePdf = async ({
  mode,
  note,
  triggerPrint,
}: {
  mode: PdfExportMode;
  note: PrintableNotePayload;
  triggerPrint?: () => void | Promise<void>;
}) => {
  if (mode === 'offline-browser') {
    await exportNotePdfOffline(triggerPrint);
    return;
  }
  await exportNotePdfExternal(note);
};
