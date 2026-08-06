'use client';

import * as React from 'react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Frank-adapted sonner Toaster (Track A5 / vendored from shadcn).
 *
 * The upstream shadcn wrapper uses next-themes; Frank does not. Theme is
 * read from the `data-frank-theme` attribute set on <html> by the layout,
 * defaulting to light (layout.tsx hard-codes light).
 */
function useFrankTheme(): 'light' | 'dark' {
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');
  React.useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute('data-frank-theme') === 'dark' ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-frank-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useFrankTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      /* Living-frame rule (Track A5): toasts surface at the top-right so they
       * never cover the frame/rail or the composer. */
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-md',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
