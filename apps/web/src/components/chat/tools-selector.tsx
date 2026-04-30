import { SlidersHorizontal } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/index.js";
import { cn } from "../../lib/utils.js";

export interface ComposerMode {
  id: string;
  label: string;
}

export interface ToolsSelectorProps {
  modes: ComposerMode[];
  selectedMode: string;
  onChange: (mode: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ToolsSelector({ modes, selectedMode, onChange, disabled, className }: ToolsSelectorProps) {
  const items = modes.length > 0 ? modes : [{ id: "chat", label: "Chat" }];

  return (
    <Select value={selectedMode || items[0]!.id} onValueChange={onChange} disabled={disabled === true}>
      <SelectTrigger
        aria-label="Tools mode"
        className={cn("h-12 w-auto min-w-32 rounded-full border-border bg-surface px-4 text-sm font-medium shadow-none", className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <SelectValue placeholder="Tools" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {items.map((mode) => (
          <SelectItem key={mode.id} value={mode.id}>
            {mode.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
