import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUp, ChevronDown, FilePlus2, FolderUp, Image, Maximize2, Mic, Paperclip, Plus } from "lucide-react";
import { Button, Textarea } from "../ui/index.js";
import { AttachmentChips, type ComposerAttachment, type ComposerAttachmentType } from "./attachment-chips.js";
import { FullscreenComposer } from "./fullscreen-composer.js";
import { ModelSelector, type ComposerModel } from "./model-selector.js";
import type { ComposerMode } from "./tools-selector.js";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target))) {
        return;
      }
      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => firstMenuItemRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

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

  function focusTextarea() {
    textareaRef.current?.focus({ preventScroll: true });
  }

  function handleComposerPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (isInteractiveComposerTarget(event.target)) {
      return;
    }
    focusTextarea();
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
    setMenuOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function openFilePicker(type: ComposerAttachmentType) {
    setMenuOpen(false);
    if (type === "folder") {
      folderInputRef.current?.click();
    } else if (type === "image") {
      imageInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  return (
    <>
      <section
        className={cn(
          "rounded-3xl border border-border bg-surface px-5 py-4 text-foreground shadow-[var(--frank-shadow-panel)]",
          className
        )}
        aria-label="Chat composer"
        onPointerDown={handleComposerPointerDown}
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
            inputMode="text"
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck={true}
            placeholder="Ask for anything..."
            className="min-h-14 border-0 bg-transparent px-0 py-1 text-base shadow-none focus-visible:ring-0"
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
            <div className="relative flex items-center gap-2">
              <Button
                ref={menuButtonRef}
                type="button"
                variant="outline"
                className="h-11 rounded-full border-border bg-surface px-4 text-sm font-medium shadow-none hover:bg-accent"
                aria-label="Open composer menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                onClick={() => setMenuOpen((open) => !open)}
                disabled={submitting}
              >
                <Plus aria-hidden="true" />
                Menu
                <ChevronDown className={cn("transition-transform", menuOpen ? "rotate-180" : "")} aria-hidden="true" />
              </Button>
              {menuOpen ? (
                <div
                  ref={menuRef}
                  id={menuId}
                  role="menu"
                  aria-label="Composer menu"
                  className="absolute bottom-full left-0 z-20 mb-2 grid w-64 gap-1 rounded-xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-[var(--frank-shadow-panel)]"
                >
                  <ComposerMenuItem ref={firstMenuItemRef} label="Attach file" icon={Paperclip} onClick={() => openFilePicker("file")} />
                  <ComposerMenuItem label="Attach folder" icon={FolderUp} onClick={() => openFilePicker("folder")} />
                  <ComposerMenuItem label="Attach image" icon={Image} onClick={() => openFilePicker("image")} />
                  <div className="my-1 h-px bg-border" role="separator" />
                  {modes.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={mode.id === selectedMode}
                      className={cn(
                        "flex min-h-10 items-center justify-between rounded-lg px-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        mode.id === selectedMode ? "bg-accent text-accent-foreground" : "text-foreground"
                      )}
                      onClick={() => handleModeChange(mode.id)}
                    >
                      <span>{mode.label}</span>
                      {mode.id === selectedMode ? (
                        <span className="text-xs text-muted-foreground" aria-hidden="true">
                          Selected
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              <ModelSelector
                models={models}
                selectedModelId={selectedModelId}
                onChange={handleModelChange}
                disabled={submitting}
                className="min-w-0"
              />
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
                className="size-11 shrink-0 rounded-full bg-primary text-primary-foreground"
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

const ComposerMenuItem = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
  }
>(({ label, icon: Icon, onClick }, ref) => (
  <button
    ref={ref}
    type="button"
    role="menuitem"
    className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-left text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    onClick={onClick}
  >
    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
    <span>{label}</span>
  </button>
));

ComposerMenuItem.displayName = "ComposerMenuItem";

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
      className="size-11 rounded-full border-border bg-surface text-foreground shadow-none hover:bg-accent"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function isInteractiveComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("a,button,input,select,textarea,[role='button'],[role='combobox'],[role='menu']"));
}
