import { useEffect, useRef } from "react";
import type * as React from "react";
import { ArrowUp, Maximize2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea
} from "../ui/index.js";
import { AttachmentChips, type ComposerAttachment } from "./attachment-chips.js";
import { ModelSelector, type ComposerModel } from "./model-selector.js";
import { ToolsSelector, type ComposerMode } from "./tools-selector.js";

export interface FullscreenComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  onTextChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  attachments: ComposerAttachment[];
  onRemoveAttachment: (id: string) => void;
  models: ComposerModel[];
  modes: ComposerMode[];
  selectedModelId: string;
  selectedMode: string;
  onModelChange: (modelId: string) => void;
  onModeChange: (mode: string) => void;
  submitting: boolean;
  error: string | null;
  notice: string | null;
}

export function FullscreenComposer({
  open,
  onOpenChange,
  text,
  onTextChange,
  onKeyDown,
  onSubmit,
  attachments,
  onRemoveAttachment,
  models,
  modes,
  selectedModelId,
  selectedMode,
  onModelChange,
  onModeChange,
  submitting,
  error,
  notice
}: FullscreenComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open]);

  function handleComposerPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (isInteractiveComposerTarget(event.target)) {
      return;
    }
    textareaRef.current?.focus({ preventScroll: true });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!h-[100dvh] !w-full !max-w-none !rounded-none p-0 sm:!h-[calc(100vh-2rem)] sm:!w-[calc(100%-2rem)] sm:!rounded-xl">
        <div className="flex min-h-0 flex-1 flex-col bg-surface">
          <DialogHeader className="border-b border-border px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center gap-3">
              <span className="hidden size-10 items-center justify-center rounded-full bg-accent text-accent-foreground sm:flex">
                <Maximize2 className="size-4" aria-hidden="true" />
              </span>
              <div className="pr-10">
                <DialogTitle>Expanded composer</DialogTitle>
                <DialogDescription>Write a longer request with the same model, tool, and attachments.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6"
            onPointerDown={handleComposerPointerDown}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <label className="sr-only" htmlFor="fullscreen-composer-message">
              Message
            </label>
            <Textarea
              ref={textareaRef}
              id="fullscreen-composer-message"
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              onKeyDown={onKeyDown}
              inputMode="text"
              enterKeyHint="send"
              autoCapitalize="sentences"
              autoComplete="off"
              spellCheck={true}
              placeholder="Ask for anything..."
              className="min-h-0 flex-1 resize-none rounded-xl bg-background p-4 text-base leading-7 shadow-none sm:p-5"
              disabled={submitting}
            />
            <AttachmentChips attachments={attachments} onRemove={onRemoveAttachment} />
            {notice ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <ToolsSelector modes={modes} selectedMode={selectedMode} onChange={onModeChange} disabled={submitting} />
                <ModelSelector models={models} selectedModelId={selectedModelId} onChange={onModelChange} disabled={submitting} />
              </div>
              <Button type="submit" className="min-h-11 rounded-full" disabled={!text.trim() || submitting} aria-busy={submitting}>
                <ArrowUp aria-hidden="true" />
                {submitting ? "Sending" : "Send"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function isInteractiveComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("a,button,input,select,textarea,[role='button'],[role='combobox']"));
}
