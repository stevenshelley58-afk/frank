import { RefreshCw, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { Alert, AlertDescription, AlertTitle, Button, Skeleton } from "../ui/index.js";

export interface ResourceErrorProps {
  title?: React.ReactNode;
  message: React.ReactNode;
  onRetry?: (() => void) | undefined;
}

export function ResourceError({ title = "Unable to load data", message, onRetry }: ResourceErrorProps) {
  return (
    <Alert variant="destructive" className="flex items-start gap-3">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </Alert>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
