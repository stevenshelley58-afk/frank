'use client';

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

/**
 * Markdown renderer for Frank's replies — the vault surface is dark ink
 * (#10120f), so prose is ivory and code blocks sit on a slightly lighter
 * panel with syntax highlighting (github-dark). GFM tables, task lists,
 * and strikethrough all work.
 */
export function Markdown({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="frank-md text-[13.5px] leading-[1.6] text-white/92">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-acid underline decoration-acid/40 underline-offset-2 hover:decoration-acid" />
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
                className="rounded-[5px] bg-white/12 px-[5px] py-[1px] font-mono text-[12.5px] text-acid"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ node, ...props }) => (
            <pre
              className="frank-md-pre my-3 overflow-x-auto rounded-xl border border-white/10 bg-[#0b0d0a] px-4 py-3.5 text-[12.5px] leading-[1.55]"
              {...props}
            />
          ),
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="border-b border-white/15 px-2.5 py-1.5 text-left font-semibold text-white/70" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="border-b border-white/8 px-2.5 py-1.5 align-top text-white/80" {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
