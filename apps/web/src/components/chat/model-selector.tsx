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
          "h-11 w-full min-w-0 rounded-full border-border bg-surface px-4 text-sm font-medium shadow-none sm:w-auto sm:min-w-44",
          className
        )}
      >
        <SelectValue placeholder="Default model" />
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
