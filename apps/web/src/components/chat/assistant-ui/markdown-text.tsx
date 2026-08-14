'use client';

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { type FC, memo, useState } from 'react';
import { Check } from '@/components/ui/icons';
import { CopyIcon } from './icons';

import { TooltipIconButton } from './tooltip-icon-button';
import { cn } from '@/lib/utils';

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="mt-3 flex items-center justify-between rounded-t-xl border border-b-0 border-line/50 bg-hover px-3.5 py-1.5 text-xs">
      <span className="font-medium lowercase text-muted">{language}</span>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {!isCopied && <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />}
        {isCopied && <Check className="animate-in zoom-in-50 fade-in duration-200 ease-out" />}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    navigator.clipboard.writeText(value).then(
      () => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), copiedDuration);
      },
      () => {},
    );
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn('mt-5 mb-2 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn('mt-5 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn('mt-4 mb-1.5 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn('mt-3.5 mb-1 scroll-m-20 text-base font-medium first:mt-0 last:mb-0', className)}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5 className={cn('mt-3 mb-1 text-sm font-semibold first:mt-0 last:mb-0', className)} {...props} />
  ),
  h6: ({ className, ...props }) => (
    <h6 className={cn('mt-3 mb-1 text-sm font-medium first:mt-0 last:mb-0', className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('my-3 leading-relaxed first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn('text-primary underline underline-offset-2 hover:text-primary/80', className)}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn('my-3 border-s-2 border-muted-foreground/30 ps-4 text-muted-foreground', className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn('my-3 ms-5 list-disc marker:text-muted-foreground [&>li]:mt-1', className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn('my-3 ms-5 list-decimal marker:text-muted-foreground [&>li]:mt-1', className)} {...props} />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn('my-3 border-muted-foreground/20', className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <table className={cn('my-3 w-full border-separate border-spacing-0 overflow-y-auto', className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        'bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right',
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        'border-s border-b border-muted-foreground/20 px-3 py-1.5 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right',
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        'm-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg',
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn('leading-relaxed', className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn('font-semibold', className)} {...props} />
  ),
  sup: ({ className, ...props }) => (
    <sup className={cn('[&>a]:text-xs [&>a]:no-underline', className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        'overflow-x-auto rounded-b-xl rounded-t-none border border-t-0 border-line/50 bg-hover p-3.5 text-[13px] leading-relaxed',
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock && 'bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.85em]',
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
