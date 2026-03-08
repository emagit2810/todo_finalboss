import React, { forwardRef } from 'react';
import LinkifyIt from 'linkify-it';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { PrintableNotePayload } from '../../exporters/notePdf';

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

const markdownComponents = {
  a: ({ node: _node, ...props }: any) => (
    <a
      {...props}
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="note-print-link"
    />
  ),
  p: ({ node: _node, ...props }: any) => <p {...props} className="note-print-paragraph" />,
  h1: ({ node: _node, ...props }: any) => <h1 {...props} className="note-print-h1" />,
  h2: ({ node: _node, ...props }: any) => <h2 {...props} className="note-print-h2" />,
  h3: ({ node: _node, ...props }: any) => <h3 {...props} className="note-print-h3" />,
  ul: ({ node: _node, ordered: _ordered, ...props }: any) => <ul {...props} className="note-print-list" />,
  ol: ({ node: _node, ordered: _ordered, ...props }: any) => <ol {...props} className="note-print-list note-print-list-ordered" />,
  li: ({ node: _node, ordered: _ordered, ...props }: any) => <li {...props} className="note-print-list-item" />,
  blockquote: ({ node: _node, ...props }: any) => <blockquote {...props} className="note-print-blockquote" />,
  pre: ({ node: _node, ...props }: any) => <pre {...props} className="note-print-pre" />,
  code: ({ node: _node, inline, ...props }: any) => {
    const isInline = Boolean(inline);
    return (
      <code
        {...props}
        className={isInline ? 'note-print-inline-code' : 'note-print-code-block'}
      />
    );
  },
  table: ({ node: _node, ...props }: any) => (
    <div className="note-print-table-wrap">
      <table {...props} className="note-print-table" />
    </div>
  ),
  th: ({ node: _node, isHeader: _isHeader, ...props }: any) => <th {...props} className="note-print-table-head" />,
  td: ({ node: _node, isHeader: _isHeader, ...props }: any) => <td {...props} className="note-print-table-cell" />,
  hr: ({ node: _node, ...props }: any) => <hr {...props} className="note-print-divider" />,
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
`;

export const NotePrintDocument = forwardRef<HTMLDivElement, { note: PrintableNotePayload }>(
  ({ note }, ref) => {
    const updatedAtLabel = new Intl.DateTimeFormat(note.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(note.updatedAt));

    return (
      <div ref={ref} className="note-print-root" aria-hidden="true">
        <article className="note-print-page">
          <header className="note-print-header">
            <h1 className="note-print-doc-title">{note.title || 'Documento sin titulo'}</h1>
            <p className="note-print-meta">Actualizado {updatedAtLabel}</p>
          </header>

          <section className="note-print-body">
            {note.contentFormat === 'markdown' ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={markdownComponents}
              >
                {note.content}
              </ReactMarkdown>
            ) : (
              <PlainTextDocumentBody content={note.content} />
            )}
          </section>
        </article>
      </div>
    );
  }
);

NotePrintDocument.displayName = 'NotePrintDocument';
