import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { resolveInlineImageIdFromUrl, transformNoteMarkdownUrl } from '../../utils/noteInlineImages';

export interface NoteMarkdownImageAsset {
  id: string;
  alt: string;
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
}

interface NoteMarkdownRendererProps {
  content: string;
  imageSources?: Record<string, NoteMarkdownImageAsset>;
  variant: 'preview' | 'print';
  onRemoveImage?: (attachmentId: string) => void;
}

const buildMarkdownComponents = ({
  imageSources,
  variant,
  onRemoveImage,
}: Required<Pick<NoteMarkdownRendererProps, 'variant'>> & {
  imageSources: Record<string, NoteMarkdownImageAsset>;
  onRemoveImage?: (attachmentId: string) => void;
}) => ({
  a: ({ node: _node, ...props }: any) => (
    <a
      {...props}
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className={variant === 'print' ? 'note-print-link' : 'text-sky-400 underline break-words'}
    />
  ),
  p: ({ node: _node, ...props }: any) => (
    <p {...props} className={variant === 'print' ? 'note-print-paragraph' : 'mb-3 leading-7 text-slate-200'} />
  ),
  h1: ({ node: _node, ...props }: any) => (
    <h1 {...props} className={variant === 'print' ? 'note-print-h1' : 'mt-5 mb-3 text-2xl font-bold text-white'} />
  ),
  h2: ({ node: _node, ...props }: any) => (
    <h2 {...props} className={variant === 'print' ? 'note-print-h2' : 'mt-4 mb-2 text-xl font-semibold text-white'} />
  ),
  h3: ({ node: _node, ...props }: any) => (
    <h3 {...props} className={variant === 'print' ? 'note-print-h3' : 'mt-4 mb-2 text-lg font-semibold text-white'} />
  ),
  ul: ({ node: _node, ordered: _ordered, ...props }: any) => (
    <ul {...props} className={variant === 'print' ? 'note-print-list' : 'mb-3 ml-5 list-disc space-y-2 text-slate-200'} />
  ),
  ol: ({ node: _node, ordered: _ordered, ...props }: any) => (
    <ol
      {...props}
      className={
        variant === 'print'
          ? 'note-print-list note-print-list-ordered'
          : 'mb-3 ml-5 list-decimal space-y-2 text-slate-200'
      }
    />
  ),
  li: ({ node: _node, ordered: _ordered, ...props }: any) => (
    <li {...props} className={variant === 'print' ? 'note-print-list-item' : 'leading-7'} />
  ),
  blockquote: ({ node: _node, ...props }: any) => (
    <blockquote
      {...props}
      className={
        variant === 'print'
          ? 'note-print-blockquote'
          : 'mb-4 border-l-4 border-slate-600 bg-slate-900/80 px-4 py-3 text-slate-300'
      }
    />
  ),
  code: ({ node: _node, inline, ...props }: any) => (
    <code
      {...props}
      className={
        variant === 'print'
          ? (inline ? 'note-print-inline-code' : 'note-print-code-block')
          : (inline ? 'rounded bg-slate-900 px-1.5 py-0.5 text-sm text-emerald-300' : 'text-emerald-200')
      }
    />
  ),
  pre: ({ node: _node, ...props }: any) => (
    <pre
      {...props}
      className={
        variant === 'print'
          ? 'note-print-pre'
          : 'mb-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-200'
      }
    />
  ),
  table: ({ node: _node, ...props }: any) => (
    <div className={variant === 'print' ? 'note-print-table-wrap' : 'mb-4 overflow-x-auto'}>
      <table
        {...props}
        className={variant === 'print' ? 'note-print-table' : 'w-full border-collapse text-left text-sm text-slate-200'}
      />
    </div>
  ),
  th: ({ node: _node, isHeader: _isHeader, ...props }: any) => (
    <th
      {...props}
      className={variant === 'print' ? 'note-print-table-head' : 'border border-slate-700 bg-slate-900 px-3 py-2'}
    />
  ),
  td: ({ node: _node, isHeader: _isHeader, ...props }: any) => (
    <td
      {...props}
      className={variant === 'print' ? 'note-print-table-cell' : 'border border-slate-800 px-3 py-2 align-top'}
    />
  ),
  hr: ({ node: _node, ...props }: any) => (
    <hr {...props} className={variant === 'print' ? 'note-print-divider' : 'my-5 border-slate-700'} />
  ),
  img: ({ node: _node, src, alt, ...props }: any) => {
    const attachmentId = resolveInlineImageIdFromUrl(src);
    if (attachmentId) {
      const asset = imageSources[attachmentId];
      if (!asset) {
        return (
          <div
            className={
              variant === 'print'
                ? 'note-print-image-missing'
                : 'my-4 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200'
            }
          >
            Imagen inline no disponible en esta vista.
          </div>
        );
      }

      if (variant === 'print') {
        return (
          <figure className="note-print-figure">
            <img
              {...props}
              src={asset.dataUrl}
              alt={asset.alt || alt || 'Imagen inline'}
              className="note-print-image"
            />
            <figcaption className="note-print-figcaption">
              {asset.alt || alt || 'Imagen inline'}
            </figcaption>
          </figure>
        );
      }

      return (
        <figure className="group relative my-5 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/80 p-3">
          {onRemoveImage && (
            <button
              type="button"
              onClick={() => onRemoveImage(attachmentId)}
              className="absolute right-4 top-4 z-10 rounded-full bg-slate-900/85 px-2 py-1 text-[11px] text-rose-200 opacity-0 transition-opacity group-hover:opacity-100"
            >
              Quitar
            </button>
          )}
          <img
            {...props}
            src={asset.dataUrl}
            alt={asset.alt || alt || 'Imagen inline'}
            className="mx-auto max-h-[420px] w-auto max-w-full rounded-xl object-contain"
          />
          <figcaption className="mt-2 text-xs text-slate-500">
            {asset.alt || alt || 'Imagen inline'}
          </figcaption>
        </figure>
      );
    }

    if (!src) {
      return null;
    }

    return (
      <img
        {...props}
        src={src}
        alt={alt}
        className={variant === 'print' ? 'note-print-image note-print-image-external' : 'my-4 max-w-full rounded-xl'}
      />
    );
  },
});

export const NoteMarkdownRenderer: React.FC<NoteMarkdownRendererProps> = ({
  content,
  imageSources = {},
  variant,
  onRemoveImage,
}) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkBreaks]}
    urlTransform={transformNoteMarkdownUrl}
    components={buildMarkdownComponents({
      imageSources,
      variant,
      onRemoveImage,
    })}
  >
    {content}
  </ReactMarkdown>
);
