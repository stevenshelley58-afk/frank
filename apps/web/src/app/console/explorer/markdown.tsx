'use client';

/**
 * Minimal dependency-free markdown → JSX renderer for the Files preview pane.
 * Covers the subset Frank's docs actually use: headings, fenced code blocks,
 * inline code, bold/italic, links, unordered/ordered lists, blockquotes,
 * tables, and paragraphs. Not a full CommonMark parser — deliberately small so
 * it adds no dependency to the live web app.
 */
import { Fragment, type ReactNode } from 'react';

function renderInline(text: string): ReactNode[] {
  // Tokenize bold, italic, inline-code, and links in one pass.
  const out: ReactNode[] = [];
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <code
          key={key++}
          className="rounded bg-hover px-1 py-0.5 font-mono text-[12px] text-ink2"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key++} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) {
        out.push(
          <a
            key={key++}
            href={lm[2]}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline decoration-accent/40 underline-offset-2"
          >
            {lm[1]}
          </a>,
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-[12px] leading-relaxed text-ink2"
        >
          {lang ? (
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted">
              {lang}
            </div>
          ) : null}
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? 'mt-2 font-display text-xl font-bold text-ink'
          : level === 2
            ? 'mt-6 border-b border-line pb-1.5 font-display text-base font-bold text-ink'
            : 'mt-4 text-[14px] font-semibold text-ink';
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(h[2])}
        </div>,
      );
      i++;
      continue;
    }

    // Blockquote.
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-3 border-l-2 border-line pl-3 text-[13px] italic text-muted"
        >
          {renderInline(buf.join(' '))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 space-y-1 pl-1">
          {items.map((it, idx) => (
            <li key={idx} className="flex gap-2 text-[13px] leading-relaxed text-ink2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-2 space-y-1 pl-1">
          {items.map((it, idx) => (
            <li key={idx} className="flex gap-2.5 text-[13px] leading-relaxed text-ink2">
              <span className="mt-px shrink-0 font-mono text-[11px] text-muted">{idx + 1}.</span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blank line.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (gather consecutive non-blank, non-special lines).
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !lines[i].startsWith('>') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 text-[13px] leading-relaxed text-ink2">
        {renderInline(buf.join(' '))}
      </p>,
    );
  }

  return <Fragment>{blocks}</Fragment>;
}
