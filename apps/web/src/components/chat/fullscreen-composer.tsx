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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100vh-2rem)] max-w-none rounded-xl p-0 sm:w-[calc(100%-2rem)]">
        <div className="flex min-h-0 flex-1 flex-col bg-surface">
          <DialogHeader className="border-b border-border px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Maximize2 className="size-4" aria-hidden="true" />
              </span>
              <div>
                <DialogTitle>Expanded composer</DialogTitle>
                <DialogDescription>Write a longer request with the same model, tool, and attachments.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-4 p-6"
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
              placeholder="Ask for anything..."
              className="min-h-0 flex-1 resize-none rounded-xl bg-background p-5 text-base leading-7 shadow-none"
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
              <div className="flex flex-wrap gap-2">
                <ToolsSelector modes={modes} selectedMode={selectedMode} onChange={onModeChange} disabled={submitting} />
                <ModelSelector models={models} selectedModelId={selectedModelId} onChange={onModelChange} disabled={submitting} />
              </div>
              <Button type="submit" className="rounded-full" disabled={!text.trim() || submitting} aria-busy={submitting}>
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
