'use client';

/**
 * Minimal collapsible used by the vendored assistant-ui tool-fallback.
 *
 * Frank's ui/ set has no Radix collapsible; the official tool-fallback
 * needs a controlled open/onOpenChange container with trigger + content.
 * This is a plain-state implementation of that API surface (no Radix
 * dependency) — same shape as the shadcn/Radix component it replaces:
 * Root (open/onOpenChange), Trigger (button toggling open), Content
 * (rendered when open, with data-state attributes for styling hooks).
 */
import {
  createContext,
  forwardRef,
  useContext,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react';

interface CollapsibleContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

function useCollapsible(): CollapsibleContextValue {
  const value = useContext(CollapsibleContext);
  if (value === null) throw new Error('Collapsible subcomponents must be used inside Collapsible.');
  return value;
}

export interface CollapsibleRootProps extends ComponentPropsWithRef<'div'> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

export const Collapsible = forwardRef<HTMLDivElement, CollapsibleRootProps>(function Collapsible(
  { open: controlledOpen, onOpenChange, defaultOpen = false, children, ...props },
  ref,
) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <CollapsibleContext.Provider value={{ open, setOpen }}>
      <div ref={ref} data-state={open ? 'open' : 'closed'} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
});
Collapsible.displayName = 'Collapsible';

export interface CollapsibleTriggerProps extends ComponentPropsWithRef<'button'> {
  asChild?: boolean;
}

export const CollapsibleTrigger = forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  function CollapsibleTrigger({ asChild = false, children, onClick, ...props }, ref) {
    const { open, setOpen } = useCollapsible();
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented) setOpen(!open);
    };
    if (asChild) {
      // asChild is not supported by this minimal implementation; treat it as
      // a plain button with the trigger behaviour (the vendored components
      // do not use asChild for collapsible triggers).
      return (
        <button ref={ref} type="button" data-state={open ? 'open' : 'closed'} onClick={handleClick} {...props}>
          {children}
        </button>
      );
    }
    return (
      <button ref={ref} type="button" data-state={open ? 'open' : 'closed'} onClick={handleClick} {...props}>
        {children}
      </button>
    );
  },
);
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

export interface CollapsibleContentProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode;
}

export const CollapsibleContent = forwardRef<HTMLDivElement, CollapsibleContentProps>(
  function CollapsibleContent({ children, ...props }, ref) {
    const { open } = useCollapsible();
    if (!open) return null;
    return (
      <div ref={ref} data-state={open ? 'open' : 'closed'} {...props}>
        {children}
      </div>
    );
  },
);
CollapsibleContent.displayName = 'CollapsibleContent';
