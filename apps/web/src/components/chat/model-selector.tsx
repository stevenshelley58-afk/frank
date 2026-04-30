import { Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../ui/index.js";
import { cn } from "../../lib/utils.js";

export interface ComposerModel {
  id: string;
  label: string;
  detail?: string | undefined;
}

export interface ModelSelectorProps {
  models: ComposerModel[];
  selectedModelId: string;
  onChange: (modelId: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export function ModelSelector({ models, selectedModelId, onChange, disabled, className }: ModelSelectorProps) {
  const items = models.length > 0 ? models : [{ id: "default", label: "Default model" }];

  return (
    <Select value={selectedModelId || items[0]!.id} onValueChange={onChange} disabled={disabled === true}>
      <SelectTrigger
        aria-label="Model"
        className={cn(
          "h-12 w-auto min-w-44 rounded-full border-border bg-surface px-4 text-sm font-medium shadow-none",
          className
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
          <SelectValue placeholder="Default model" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {items.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
