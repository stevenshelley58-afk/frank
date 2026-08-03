'use client';

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

/**
 * Markdown renderer for Frank's replies — Atlantic DS 1.1.
 *
 * Frank's replies sit on blue-white cards (`bg-card`, ink text), so prose
 * and tables use the Atlantic ink/muted tokens. Code blocks stay on their
 * own dark panel (github-dark) — readable on either surface, and it reads
 * like ChatGPT. GFM tables, task lists, and strikethrough all work.
 */
export function Markdown({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="frank-md text-[13.5px] leading-[1.6] text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent" />
          ),
          code: ({ node, className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-[5px] bg-ink/8 px-[5px] py-[1px] font-mono text-[12.5px] text-accent"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ node, ...props }) => (
            <pre
              className="frank-md-pre my-3 overflow-x-auto rounded-xl border border-white/10 bg-[#0b0d0a] px-4 py-3.5 text-[12.5px] leading-[1.55] text-white"
              {...props}
            />
          ),
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border-b border-line px-2.5 py-1.5 text-left font-semibold text-ink" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border-b border-line px-2.5 py-1.5 align-top text-ink2" {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
