'use client';

/**
 * Vendored from assistant-ui (MIT) — `tool-fallback.tsx` — the default
 * renderer for tool-call parts that have no dedicated UI. Frank renders
 * Hermes 'tool' SSE events through this component (W2-2 requirement: tool
 * calls visible in the transcript with assistant-ui's tool-call UI).
 *
 * Adaptations from upstream: local lucide-compatible icons (Frank has no
 * lucide dep), local Collapsible (Frank's ui/ set has none), Frank tokens.
 */

import { memo, useCallback, useRef, useState } from 'react';
import {
  useToolCallElapsed,
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AlertCircleIcon, LoaderIcon, XCircleIcon } from './icons';
import { Check, ChevronDown } from '@/components/ui/icons';

const ANIMATION_DURATION = 200;

const pressable = 'active:scale-[0.98]';

export type ToolFallbackRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
};

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('w-full', className)}
      {...props}
    >
      {children}
    </Collapsible>
  );
}

type ToolStatus = ToolCallMessagePartStatus['type'];

const statusIconMap: Record<ToolStatus, React.ElementType> = {
  running: LoaderIcon,
  complete: Check,
  incomplete: XCircleIcon,
  'requires-action': AlertCircleIcon,
};

const formatToolDuration = (ms: number) => {
  if (ms < 1000) return '<1s';
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
};

function ToolFallbackDuration({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  const elapsedMs = useToolCallElapsed();
  if (elapsedMs === undefined) return null;

  return (
    <span
      data-slot="tool-fallback-duration"
      className={cn('text-xs tabular-nums text-muted', className)}
      {...props}
    >
      {formatToolDuration(elapsedMs)}
    </span>
  );
}

function ToolFallbackTrigger({
  toolName,
  status,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string;
  status?: ToolCallMessagePartStatus;
}) {
  const statusType = status?.type ?? 'complete';
  const isRunning = statusType === 'running';
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled';

  const Icon = statusIconMap[statusType];
  const label = isCancelled ? 'Cancelled tool' : 'Used tool';

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      className={cn(
        'flex w-fit origin-left items-center gap-2 py-1.5 text-sm text-muted transition-[color,scale] hover:text-ink active:scale-[0.98]',
        className,
      )}
      {...props}
    >
      <Icon
        data-slot="tool-fallback-trigger-icon"
        className={cn(
          'h-4 w-4 shrink-0',
          isCancelled && 'text-muted',
          isRunning && 'animate-spin [animation-duration:0.6s]',
        )}
      />
      <span
        data-slot="tool-fallback-trigger-label"
        className={cn(
          'relative inline-block text-start leading-none',
          isCancelled && 'text-muted line-through',
        )}
      >
        <span>
          {label}: <b>{toolName}</b>
        </span>
      </span>
      <ToolFallbackDuration />
      <ChevronDown
        data-slot="tool-fallback-trigger-chevron"
        className={cn('h-4 w-4 shrink-0 transition-transform', '-rotate-90', 'group-data-open/trigger:rotate-0')}
      />
    </CollapsibleTrigger>
  );
}

function ToolFallbackContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn('relative overflow-hidden text-sm outline-none', className)}
      {...props}
    >
      <div className="flex flex-col gap-2 pb-2 ps-6 pt-1">{children}</div>
    </CollapsibleContent>
  );
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  argsText?: string;
}) {
  if (!argsText) return null;

  return (
    <div data-slot="tool-fallback-args" className={cn('', className)} {...props}>
      <pre className="rounded-md bg-hover p-2.5 text-xs whitespace-pre-wrap text-ink/90">
        {argsText}
      </pre>
    </div>
  );
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  result?: unknown;
}) {
  if (result === undefined) return null;

  return (
    <div data-slot="tool-fallback-result" className={cn('', className)} {...props}>
      <p className="text-xs font-medium text-muted">Result:</p>
      <pre className="mt-1 rounded-md bg-hover p-2.5 text-xs whitespace-pre-wrap text-ink/90">
        {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  status?: ToolCallMessagePartStatus;
}) {
  if (status?.type !== 'incomplete') return null;

  const error = status.error;
  const errorText = error
    ? typeof error === 'string'
      ? error
      : JSON.stringify(error)
    : null;

  if (!errorText) return null;

  const isCancelled = status.reason === 'cancelled';
  const headerText = isCancelled ? 'Cancelled reason:' : 'Error:';

  return (
    <div data-slot="tool-fallback-error" className={cn('', className)} {...props}>
      <p className="font-semibold text-muted">{headerText}</p>
      <p className="text-muted">{errorText}</p>
    </div>
  );
}

const APPROVED_RESULT = 'Approved by user';
const DENIED_RESULT = 'User denied tool execution';

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  'allow-once': 'Allow',
  'allow-always': 'Always allow',
  'reject-once': 'Deny',
  'reject-always': 'Always deny',
};

const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always';

const approvalOptionLabel = (option: ToolApprovalOption) =>
  option.label ??
  (Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, option.kind)
    ? APPROVAL_OPTION_DEFAULT_LABELS[option.kind]
    : undefined) ??
  option.id;

function ToolFallbackApproval({
  className,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  ...props
}: React.ComponentProps<'div'> &
  Partial<Pick<ToolCallMessagePartProps, 'addResult' | 'resume' | 'respondToApproval'>> & {
    interrupt?: ToolCallMessagePart['interrupt'];
    approval?: ToolCallMessagePart['approval'];
  }) {
  const [submitted, setSubmitted] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (
    approval != null &&
    (approval.approved !== undefined || approval.resolution !== undefined)
  )
    return null;

  const declaredOptions = respondToApproval ? approval?.options : undefined;
  const options = declaredOptions?.filter((o) =>
    Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, o.kind),
  );

  const respond = (approved: boolean) => {
    if (submitted) return;
    if (approval != null && approval.approved === undefined && respondToApproval) {
      respondToApproval({ approved });
    } else if (interrupt) {
      resume?.({ approved });
    } else {
      addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT);
    }
    setSubmitted(true);
  };

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted) return;
    respondToApproval?.({ optionId: option.id });
    setSubmitted(true);
    setConfirmingId(null);
  };

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id);
    } else {
      respondWithOption(option);
    }
  };

  const confirming =
    confirmingId != null
      ? options?.find((o) => o.id === confirmingId)
      : undefined;

  if (confirming) {
    const confirmMeta =
      typeof confirming.confirm === 'object' ? confirming.confirm : undefined;
    const confirmDescription =
      confirmMeta?.description ?? confirming.description;
    return (
      <div
        data-slot="tool-fallback-approval-confirm"
        className={cn('flex flex-col gap-2 pt-1', className)}
        {...props}
      >
        <p className="font-semibold">
          {confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
        </p>
        {confirmDescription && (
          <p className="text-muted">{confirmDescription}</p>
        )}
        {confirming.grants && confirming.grants.length > 0 && (
          <ul className="flex flex-col gap-1">
            {confirming.grants.map((grant) => (
              <li key={grant}>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{grant}</code>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className={pressable}
            onClick={() => respondWithOption(confirming)}
            disabled={submitted}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={pressable}
            onClick={() => setConfirmingId(null)}
            disabled={submitted}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = options?.filter((o) => isAllowKind(o.kind)) ?? [];
    const rejectOptions = options?.filter((o) => !isAllowKind(o.kind)) ?? [];
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn('flex flex-wrap items-center gap-2 pt-1', className)}
        {...props}
      >
        {[...allowOptions, ...rejectOptions].map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option === allowOptions[0] ? 'default' : 'outline'}
            className={pressable}
            onClick={() => handleOption(option)}
            disabled={submitted}
          >
            {approvalOptionLabel(option)}
          </Button>
        ))}
        {rejectOptions.length === 0 && (
          <Button
            size="sm"
            variant="outline"
            className={pressable}
            onClick={() => respond(false)}
            disabled={submitted}
          >
            Deny
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      data-slot="tool-fallback-approval"
      className={cn('flex items-center gap-2 pt-1', className)}
      {...props}
    >
      <Button
        size="sm"
        className={pressable}
        onClick={() => respond(true)}
        disabled={submitted}
      >
        Allow
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={pressable}
        onClick={() => respond(false)}
        disabled={submitted}
      >
        Deny
      </Button>
    </div>
  );
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
}) => {
  const isCancelled =
    status?.type === 'incomplete' && status.reason === 'cancelled';
  const isRequiresAction = status?.type === 'requires-action';

  const [open, setOpen] = useState(isRequiresAction);
  const [prevRequiresAction, setPrevRequiresAction] =
    useState(isRequiresAction);
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction);
    if (isRequiresAction) setOpen(true);
  }

  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen}>
      <ToolFallbackTrigger toolName={toolName} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs
          argsText={argsText}
          className={cn(isCancelled && 'opacity-60')}
        />
        {isRequiresAction && (
          <ToolFallbackApproval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={approval}
            respondToApproval={respondToApproval}
          />
        )}
        {!isCancelled && <ToolFallbackResult result={result} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
};

const ToolFallback = memo(
  ToolFallbackImpl,
) as unknown as ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot;
  Trigger: typeof ToolFallbackTrigger;
  Content: typeof ToolFallbackContent;
  Args: typeof ToolFallbackArgs;
  Result: typeof ToolFallbackResult;
  Error: typeof ToolFallbackError;
  Approval: typeof ToolFallbackApproval;
};

ToolFallback.displayName = 'ToolFallback';
ToolFallback.Root = ToolFallbackRoot;
ToolFallback.Trigger = ToolFallbackTrigger;
ToolFallback.Content = ToolFallbackContent;
ToolFallback.Args = ToolFallbackArgs;
ToolFallback.Result = ToolFallbackResult;
ToolFallback.Error = ToolFallbackError;
ToolFallback.Approval = ToolFallbackApproval;

export {
  ToolFallback,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  ToolFallbackContent,
  ToolFallbackArgs,
  ToolFallbackResult,
  ToolFallbackError,
  ToolFallbackApproval,
};
