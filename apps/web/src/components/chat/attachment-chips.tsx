import { File, Folder, Image, X } from "lucide-react";
import { Button } from "../ui/index.js";
import { cn } from "../../lib/utils.js";

export type ComposerAttachmentType = "file" | "folder" | "image";

export interface ComposerAttachment {
  id: string;
  name: string;
  type: ComposerAttachmentType;
  size?: number | undefined;
}

export interface AttachmentChipsProps {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
  className?: string | undefined;
}

const iconByType = {
  file: File,
  folder: Folder,
  image: Image
} satisfies Record<ComposerAttachmentType, typeof File>;

export function AttachmentChips({ attachments, onRemove, className }: AttachmentChipsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)} aria-label="Selected attachments">
      {attachments.map((attachment) => {
        const Icon = iconByType[attachment.type];
        return (
          <span
            key={attachment.id}
            className="inline-flex max-w-56 items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-medium text-foreground"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{attachment.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(attachment.id)}
            >
              <X className="size-3" aria-hidden="true" />
            </Button>
          </span>
        );
      })}
    </div>
  );
}
