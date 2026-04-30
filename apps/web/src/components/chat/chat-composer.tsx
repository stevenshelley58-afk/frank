import { useRef, useState } from "react";
import type * as React from "react";
import { ArrowUp, FilePlus2, FolderUp, Image, Maximize2, Mic, Paperclip, Plus } from "lucide-react";
import { Button, Textarea } from "../ui/index.js";
import { AttachmentChips, type ComposerAttachment, type ComposerAttachmentType } from "./attachment-chips.js";
import { FullscreenComposer } from "./fullscreen-composer.js";
import { ModelSelector, type ComposerModel } from "./model-selector.js";
import { ToolsSelector, type ComposerMode } from "./tools-selector.js";
import { cn } from "../../lib/utils.js";

export type { ComposerMode } from "./tools-selector.js";
export type { ComposerModel } from "./model-selector.js";
export type { ComposerAttachment } from "./attachment-chips.js";

export interface ComposerSubmitInput {
  text: string;
  selectedModelId: string;
  selectedMode: string;
  attachments: ComposerAttachment[];
}

export interface ChatComposerProps {
  models: ComposerModel[];
  modes: ComposerMode[];
  selectedModelId: string;
  selectedMode: string;
  onModelChange: (modelId: string) => void;
  onModeChange: (mode: string) => void;
  onSubmit: (input: ComposerSubmitInput) => Promise<void> | void;
  className?: string | undefined;
}

export function ChatComposer({
  models,
  modes,
  selectedModelId,
  selectedMode,
  onModelChange,
  onModeChange,
  onSubmit,
  className
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  async function submitMessage() {
    const trimmed = text.trim();
    if (!trimmed || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        text: trimmed,
        selectedModelId,
        selectedMode,
        attachments
      });
      setText("");
      setAttachments([]);
      setNotice(null);
      setFullscreenOpen(false);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to send this request.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function handleFiles(type: ComposerAttachmentType, files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    const nextAttachments = Array.from(files).map((file) => ({
      id: `${type}-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      name: file.webkitRelativePath || file.name,
      type,
      size: file.size
    }));
    setAttachments((current) => [...current, ...nextAttachments].slice(0, 12));
    setNotice("Attachments are staged locally only. Upload is not wired yet.");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleModelChange(modelId: string) {
    onModelChange(modelId);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function handleModeChange(mode: string) {
    onModeChange(mode);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  return (
    <>
      <section
        className={cn(
          "rounded-[2rem] border border-border bg-surface px-5 py-4 text-foreground shadow-[var(--frank-shadow-panel)]",
          className
        )}
        aria-label="Chat composer"
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage();
          }}
        >
          <label className="sr-only" htmlFor="chat-composer-message">
            Message
          </label>
          <Textarea
            ref={textareaRef}
            id="chat-composer-message"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask for anything..."
            className="min-h-14 border-0 bg-transparent px-1 py-1 text-base shadow-none focus-visible:ring-0"
            disabled={submitting}
          />
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
          {notice ? (
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ComposerIconButton label="Add" onClick={() => fileInputRef.current?.click()}>
                <Plus aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton label="Attach file" onClick={() => fileInputRef.current?.click()}>
                <Paperclip aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton label="Attach folder" onClick={() => folderInputRef.current?.click()}>
                <FolderUp aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton label="Attach image" onClick={() => imageInputRef.current?.click()}>
                <Image aria-hidden="true" />
              </ComposerIconButton>
              <ToolsSelector modes={modes} selectedMode={selectedMode} onChange={handleModeChange} disabled={submitting} />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <ModelSelector models={models} selectedModelId={selectedModelId} onChange={handleModelChange} disabled={submitting} />
              <ComposerIconButton
                label="Start voice input"
                onClick={() => {
                  setNotice("Voice input is not wired yet.");
                  window.setTimeout(() => textareaRef.current?.focus(), 0);
                }}
              >
                <Mic aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton label="Expand composer" onClick={() => setFullscreenOpen(true)}>
                <Maximize2 aria-hidden="true" />
              </ComposerIconButton>
              <Button
                type="submit"
                size="icon"
                className="size-12 rounded-full bg-primary text-primary-foreground"
                disabled={!text.trim() || submitting}
                aria-label="Send message"
                aria-busy={submitting}
              >
                {submitting ? <FilePlus2 aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </form>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => handleFiles("file", event.currentTarget.files)}
        />
        <input
          ref={folderInputRef}
          className="hidden"
          type="file"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(event) => handleFiles("folder", event.currentTarget.files)}
        />
        <input
          ref={imageInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => handleFiles("image", event.currentTarget.files)}
        />
      </section>
      <FullscreenComposer
        open={fullscreenOpen}
        onOpenChange={setFullscreenOpen}
        text={text}
        onTextChange={setText}
        onKeyDown={handleKeyDown}
        onSubmit={() => void submitMessage()}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        models={models}
        modes={modes}
        selectedModelId={selectedModelId}
        selectedMode={selectedMode}
        onModelChange={handleModelChange}
        onModeChange={handleModeChange}
        submitting={submitting}
        error={error}
        notice={notice}
      />
    </>
  );
}

function ComposerIconButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-12 rounded-full border-border bg-surface text-foreground shadow-none hover:bg-accent"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
