import { defaultUrlTransform } from 'react-markdown';
import { AttachmentMeta } from '../types';

export interface InlineImageRef {
  attachmentId: string;
  alt: string;
  token: string;
  start: number;
  end: number;
}

export interface NoteInlineImageAsset {
  id: string;
  alt: string;
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export const NOTE_INLINE_IMAGE_PROTOCOL = 'attachment://';
const NOTE_INLINE_IMAGE_TOKEN_REGEX = /!\[([^\]]*)\]\(attachment:\/\/([^)]+)\)/g;
const IMAGE_PREVIEW_MAX_DIMENSION = 1600;
const IMAGE_PREVIEW_MAX_SIZE_BYTES = 900_000;

export const buildInlineImageMarkdownToken = (attachment: AttachmentMeta) => {
  const alt = sanitizeInlineImageAlt(attachment.alt || attachment.name || 'imagen');
  return `![${alt}](${NOTE_INLINE_IMAGE_PROTOCOL}${attachment.id})`;
};

export const extractInlineImageRefs = (content: string) => {
  const refs: InlineImageRef[] = [];
  const normalized = content || '';
  const regex = new RegExp(NOTE_INLINE_IMAGE_TOKEN_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    refs.push({
      attachmentId: match[2],
      alt: match[1],
      token: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return refs;
};

export const hasInlineImageRefs = (content: string) => extractInlineImageRefs(content).length > 0;

export const resolveInlineImageIdFromUrl = (src?: string) => {
  if (!src || !src.startsWith(NOTE_INLINE_IMAGE_PROTOCOL)) return null;
  return src.slice(NOTE_INLINE_IMAGE_PROTOCOL.length);
};

export const transformNoteMarkdownUrl = (
  value: string,
  key?: string,
  node?: { tagName?: string } | null
) => {
  if (key === 'src' && node?.tagName === 'img' && value.startsWith(NOTE_INLINE_IMAGE_PROTOCOL)) {
    return value;
  }
  return defaultUrlTransform(value);
};

export const replaceInlineImageTokens = (
  content: string,
  resolveAsset: (ref: InlineImageRef) => NoteInlineImageAsset | undefined
) => {
  let nextContent = content || '';
  const refs = extractInlineImageRefs(nextContent);
  refs.forEach((ref) => {
    const asset = resolveAsset(ref);
    if (!asset) return;
    const replacement = `![${sanitizeInlineImageAlt(asset.alt || ref.alt || 'imagen')}](${asset.dataUrl})`;
    nextContent = nextContent.replace(ref.token, replacement);
  });
  return nextContent;
};

export const insertInlineImageTokensAtSelection = ({
  content,
  selectionStart,
  selectionEnd,
  attachments,
}: {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  attachments: AttachmentMeta[];
}) => {
  const tokens = attachments.map(buildInlineImageMarkdownToken).join('\n\n');
  const before = content.slice(0, selectionStart);
  const after = content.slice(selectionEnd);
  const needsLeadingBreak = before.length > 0 && !before.endsWith('\n');
  const needsTrailingBreak = after.length > 0 && !after.startsWith('\n');
  const trailingBreak = after.length === 0 ? '\n' : needsTrailingBreak ? '\n\n' : '\n';
  const insertion = `${needsLeadingBreak ? '\n\n' : ''}${tokens}${trailingBreak}`;
  const nextContent = `${before}${insertion}${after}`;
  const nextSelection = before.length + insertion.length;

  return {
    nextContent,
    nextSelection,
  };
};

export const removeInlineImageTokenByAttachmentId = (content: string, attachmentId: string) => {
  const escapedId = attachmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRegex = new RegExp(`!?\\[[^\\]]*\\]\\(attachment:\\/\\/${escapedId}\\)\\s*`, 'g');
  return (content || '')
    .replace(tokenRegex, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const deriveInlineImageAlt = (name: string) => {
  const cleanName = (name || 'imagen')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return sanitizeInlineImageAlt(cleanName || 'imagen');
};

export const sanitizeInlineImageAlt = (value: string) =>
  (value || 'imagen').replace(/[\]\[]/g, '').trim() || 'imagen';

export const readBlobAsDataUrl = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('No se pudo convertir la imagen a data URL.'));
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(blob);
  });

const loadImageElement = async (blob: Blob) => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const readImageDimensions = async (blob: Blob) => {
  const image = await loadImageElement(blob);
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
};

export const buildInlineImagePreviewBlob = async (blob: Blob) => {
  const image = await loadImageElement(blob);
  const { naturalWidth, naturalHeight } = image;
  const maxDimension = Math.max(naturalWidth, naturalHeight);

  if (maxDimension <= IMAGE_PREVIEW_MAX_DIMENSION && blob.size <= IMAGE_PREVIEW_MAX_SIZE_BYTES) {
    return {
      blob,
      width: naturalWidth,
      height: naturalHeight,
      reusedOriginal: true,
    };
  }

  const scale = IMAGE_PREVIEW_MAX_DIMENSION / maxDimension;
  const width = Math.max(1, Math.round(naturalWidth * Math.min(1, scale)));
  const height = Math.max(1, Math.round(naturalHeight * Math.min(1, scale)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    return {
      blob,
      width: naturalWidth,
      height: naturalHeight,
      reusedOriginal: true,
    };
  }

  context.drawImage(image, 0, 0, width, height);

  const previewBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.9);
  });

  return {
    blob: previewBlob || blob,
    width: naturalWidth,
    height: naturalHeight,
    reusedOriginal: !previewBlob,
  };
};

export const isInlineImageAttachment = (attachment: AttachmentMeta) => attachment.kind === 'inline-image';
