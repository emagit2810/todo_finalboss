import React, { forwardRef } from 'react';
import LinkifyIt from 'linkify-it';
import { PrintableNotePayload } from '../../exporters/notePdf';
import { NoteMarkdownRenderer } from './NoteMarkdownRenderer';

const linkify = new LinkifyIt();

const linkifyText = (text: string) => {
  const matches = linkify.match(text);
  if (!matches || matches.length === 0) return text;

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    if (match.index > cursor) {
      segments.push(
        <React.Fragment key={`text-${index}`}>
          {text.slice(cursor, match.index)}
        </React.Fragment>
      );
    }
    segments.push(
      <a
        key={`link-${index}`}
        href={match.url}
        target="_blank"
        rel="noreferrer"
        className="note-print-link"
      >
        {match.text}
      </a>
    );
    cursor = match.lastIndex;
  });

  if (cursor < text.length) {
    segments.push(<React.Fragment key="text-tail">{text.slice(cursor)}</React.Fragment>);
  }

  return segments;
};

const PlainTextDocumentBody: React.FC<{ content: string }> = ({ content }) => {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const blocks = normalized.length > 0 ? normalized.split(/\n{2,}/) : [];

  return (
    <>
      {blocks.map((block, blockIndex) => (
        <p key={`block-${blockIndex}`} className="note-print-paragraph">
          {block.split('\n').map((line, lineIndex) => (
            <React.Fragment key={`line-${blockIndex}-${lineIndex}`}>
              {lineIndex > 0 && <br />}
              {linkifyText(line)}
            </React.Fragment>
          ))}
        </p>
      ))}
    </>
  );
};

export const NOTE_PRINT_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 22mm 18mm 22mm 18mm;
  }

  @media screen {
    .note-print-root {
      position: fixed;
      left: -200vw;
      top: 0;
      width: 210mm;
      opacity: 0;
      pointer-events: none;
    }
  }

  @media print {
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      color: #111827 !important;
      font-family: Arial, sans-serif !important;
      font-size: 11pt !important;
      line-height: 1.5 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .note-print-root {
      position: static !important;
      left: 0 !important;
      top: 0 !important;
      width: auto !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    .note-print-page {
      width: auto !important;
      min-height: auto !important;
      margin: 0 !important;
      background: #ffffff !important;
      box-shadow: none !important;
    }
  }

  .note-print-page {
    background: #ffffff;
    color: #111827;
    width: 100%;
    min-height: 100%;
    box-sizing: border-box;
  }

  .note-print-header {
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid #dbe3ef;
  }

  .note-print-doc-title {
    margin: 0 0 6px;
    font-size: 20pt;
    line-height: 1.2;
    font-weight: 700;
    break-after: avoid-page;
  }

  .note-print-meta {
    margin: 0;
    color: #64748b;
    font-size: 9pt;
  }

  .note-print-body {
    font-size: 11pt;
    line-height: 1.5;
  }

  .note-print-link {
    color: #1155cc !important;
    text-decoration: underline !important;
    word-break: break-word;
  }

  .note-print-paragraph,
  .note-print-list-item {
    margin: 0 0 12px;
    orphans: 3;
    widows: 3;
  }

  .note-print-h1,
  .note-print-h2,
  .note-print-h3,
  .note-print-paragraph,
  .note-print-list,
  .note-print-blockquote,
  .note-print-pre,
  .note-print-table-wrap {
    break-inside: avoid-page;
  }

  .note-print-h1 {
    margin: 22px 0 12px;
    font-size: 20pt;
    line-height: 1.25;
    font-weight: 700;
  }

  .note-print-h2 {
    margin: 18px 0 10px;
    font-size: 16pt;
    line-height: 1.3;
    font-weight: 700;
  }

  .note-print-h3 {
    margin: 16px 0 8px;
    font-size: 13pt;
    line-height: 1.35;
    font-weight: 700;
  }

  .note-print-list {
    margin: 0 0 14px 20px;
    padding: 0;
  }

  .note-print-list-ordered {
    list-style-type: decimal;
  }

  .note-print-blockquote {
    margin: 0 0 14px;
    padding: 8px 0 8px 14px;
    border-left: 3px solid #cbd5e1;
    color: #334155;
    background: #f8fafc;
  }

  .note-print-pre {
    margin: 0 0 14px;
    padding: 12px;
    border: 1px solid #dbe3ef;
    border-radius: 6px;
    background: #f8fafc;
    font-size: 10pt;
    line-height: 1.45;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .note-print-inline-code,
  .note-print-code-block {
    font-family: "Courier New", monospace;
  }

  .note-print-inline-code {
    background: #eff3f8;
    border-radius: 4px;
    padding: 1px 4px;
  }

  .note-print-table-wrap {
    margin: 0 0 14px;
    overflow-x: auto;
  }

  .note-print-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
  }

  .note-print-table-head,
  .note-print-table-cell {
    border: 1px solid #cbd5e1;
    padding: 8px 10px;
    vertical-align: top;
    text-align: left;
  }

  .note-print-table-head {
    background: #eff3f8;
    font-weight: 700;
  }

  .note-print-divider {
    border: 0;
    border-top: 1px solid #dbe3ef;
    margin: 18px 0;
  }

  .note-print-figure,
  .note-print-image-external,
  .note-print-appendix-item {
    break-inside: avoid-page;
  }

  .note-print-figure {
    margin: 0 0 16px;
  }

  .note-print-image {
    display: block;
    max-width: 100%;
    width: auto;
    height: auto;
    max-height: 220mm;
    margin: 0 auto;
    border-radius: 10px;
    object-fit: contain;
  }

  .note-print-figcaption {
    margin-top: 8px;
    color: #64748b;
    font-size: 9pt;
    text-align: center;
  }

  .note-print-image-missing {
    margin: 0 0 14px;
    padding: 10px 12px;
    border: 1px dashed #d97706;
    border-radius: 8px;
    color: #92400e;
    background: #fffbeb;
    font-size: 9.5pt;
  }

  .note-print-appendices {
    margin-top: 28px;
    break-before: page;
  }

  .note-print-appendices-title {
    margin: 0 0 14px;
    font-size: 18pt;
    line-height: 1.25;
    font-weight: 700;
  }

  .note-print-appendix-item {
    margin: 0 0 20px;
  }

  .note-print-appendix-item-title {
    margin: 0 0 10px;
    font-size: 12pt;
    line-height: 1.35;
    font-weight: 700;
  }
`;

export const NotePrintDocument = forwardRef<HTMLDivElement, { note: PrintableNotePayload }>(
  ({ note }, ref) => {
    const updatedAtLabel = new Intl.DateTimeFormat(note.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(note.updatedAt));
    const imageSources = Object.fromEntries((note.assets || []).map((asset) => [asset.id, asset]));
    const markdownContent = note.resolvedContent || note.content;

    return (
      <div ref={ref} className="note-print-root" aria-hidden="true">
        <article className="note-print-page">
          <header className="note-print-header">
            <h1 className="note-print-doc-title">{note.title || 'Documento sin titulo'}</h1>
            <p className="note-print-meta">Actualizado {updatedAtLabel}</p>
          </header>

          <section className="note-print-body">
            {note.contentFormat === 'markdown' ? (
              <NoteMarkdownRenderer
                content={markdownContent}
                imageSources={imageSources}
                variant="print"
              />
            ) : (
              <PlainTextDocumentBody content={note.content} />
            )}
          </section>

          {note.appendices && note.appendices.length > 0 && (
            <section className="note-print-appendices">
              <h2 className="note-print-appendices-title">Anexos de texto</h2>
              {note.appendices.map((appendix) => (
                <article key={appendix.id} className="note-print-appendix-item">
                  <h3 className="note-print-appendix-item-title">{appendix.title}</h3>
                  <PlainTextDocumentBody content={appendix.text} />
                </article>
              ))}
            </section>
          )}
        </article>
      </div>
    );
  }
);

NotePrintDocument.displayName = 'NotePrintDocument';
